import type { Album, Artist, LibrarySort, Track } from '@shared/ipc-contract'
import { transaction, type Db } from '../connection'
import type { LibraryAlbum, LibrarySong } from '../../net/schemas'
import { countComposers, splitComposers } from './composers'

// Kütüphane bölümleri: Şarkılar, Albümler, Sanatçılar (arayüz veri kapsamı). Apple'daki sırayla
// (`position`) saklanır; okuma sayfalı ve sıralamalı (ad / sanatçı / Apple sırası). Tamamı
// değiştirilerek senkronize edilir (LibrarySync, SWR). Çıkışta silinir.
//
// A4 (büyük kütüphane): 50.000 satırı indeksli tabloya tek transaction'da yazmak worker'ı ~0,9 sn
// bloklar (sayfa okumaları, arama bekler). `chunkSize`'tan büyük liste aynı DDL'li geçici tabloya
// parça parça (aralarda olay döngüsüne dönülerek) yazılır; sonra tek transaction'da eski tablo
// atılır, geçici tablo yeniden adlandırılır ve indeksler toplu kurulur (~0,2 sn). Okumalar takasa
// kadar eski veriyi görür (yarım kütüphane görünmez).

export const STAGED_CHUNK_SIZE = 5_000
const TABLES = ['library_song', 'library_album', 'library_artist'] as const
type Table = (typeof TABLES)[number]
const stageOf = (table: Table): string => `${table}_stage`

export interface ReplaceOptions {
  /** Bu sayıdan büyük liste geçici tabloya parça parça yazılır. */
  chunkSize?: number
  /** Parçalar arasında beklenir (varsayılan: `setImmediate`). */
  yieldFn?: () => Promise<void>
  /**
   * Her parçadan ve takastan önce sorulur; `false` → yazma bırakılır, eski veri kalır (çıkış yapıldı
   * veya kapsamda yeni yerel yazma var).
   */
  isCurrent?: () => boolean
}

/** Sıralama ifadeleri; her biri birebir bir indeksle karşılanır (migration 11, A4). */
export const COLLECTION_SORTS = {
  song: {
    name: 'name COLLATE NOCASE, artist_name COLLATE NOCASE',
    artist: 'artist_name COLLATE NOCASE, album_name COLLATE NOCASE, name COLLATE NOCASE',
    recent: 'position'
  },
  album: {
    name: 'name COLLATE NOCASE',
    artist: 'artist_name COLLATE NOCASE, name COLLATE NOCASE',
    recent: 'position'
  },
  artist: { name: 'name COLLATE NOCASE', artist: 'name COLLATE NOCASE', recent: 'position' }
} as const satisfies Record<string, Record<LibrarySort, string>>

const json = (v: unknown): string | null => (v == null ? null : JSON.stringify(v))
function parsePlayParams(text: string | null): Track['playParams'] {
  if (text === null) return null
  try {
    const v = JSON.parse(text) as Track['playParams']
    return v && typeof v.id === 'string' && typeof v.kind === 'string' ? v : null
  } catch {
    return null
  }
}

interface SongRow {
  id: string
  name: string
  artist_name: string
  album_name: string
  duration_ms: number | null
  play_params: string | null
  artwork_url: string | null
  explicit: number
}
interface AlbumRow {
  id: string
  name: string
  artist_name: string
  track_count: number | null
  play_params: string | null
  artwork_url: string | null
  explicit: number
  release_date: string | null
}
const toSong = (r: SongRow): Track => ({
  id: r.id,
  name: r.name,
  artistName: r.artist_name,
  albumName: r.album_name,
  durationMs: r.duration_ms,
  playParams: parsePlayParams(r.play_params),
  artworkUrl: r.artwork_url,
  ...(r.explicit === 1 ? { explicit: true } : {})
})

const toAlbumRow = (r: AlbumRow): Album => ({
  id: r.id,
  name: r.name,
  artistName: r.artist_name,
  trackCount: r.track_count,
  playParams: parsePlayParams(r.play_params),
  artworkUrl: r.artwork_url,
  ...(r.explicit === 1 ? { explicit: true } : {}),
  ...(r.release_date !== null ? { releaseDate: r.release_date } : {})
})

/** LIKE kalıbı için `%`, `_` ve kaçış karakteri kaçırılır (ESCAPE '\'). */
const likeEscape = (v: string): string => v.replace(/[\\%_]/g, (c) => `\\${c}`)

interface ArtistRow {
  id: string
  name: string
  artwork_url: string | null
}

export class LibraryCollectionsRepository {
  constructor(private readonly db: Db) {}

  /** `false`: yazma bırakıldı (`isCurrent`), eski veri duruyor. */
  replaceSongs(songs: readonly LibrarySong[], options?: ReplaceOptions): Promise<boolean> {
    return this.replace('library_song', options, songs, (s, position) => ({
      id: s.id,
      name: s.name,
      artist_name: s.artistName,
      album_name: s.albumName,
      duration_ms: s.durationMs,
      play_params: json(s.playParams),
      artwork_url: s.artworkUrl,
      explicit: s.explicit ? 1 : 0,
      genre: s.genre ?? null,
      composer: s.composer ?? null,
      position
    }))
  }

  replaceAlbums(albums: readonly LibraryAlbum[], options?: ReplaceOptions): Promise<boolean> {
    return this.replace('library_album', options, albums, (a, position) => ({
      id: a.id,
      name: a.name,
      artist_name: a.artistName,
      track_count: a.trackCount,
      play_params: json(a.playParams),
      artwork_url: a.artworkUrl,
      explicit: a.explicit ? 1 : 0,
      release_date: a.releaseDate ?? null,
      genre: a.genre ?? null,
      is_compilation: a.compilation ? 1 : 0,
      position
    }))
  }

  replaceArtists(artists: readonly Artist[], options?: ReplaceOptions): Promise<boolean> {
    return this.replace('library_artist', options, artists, (a, position) => ({
      id: a.id,
      name: a.name,
      artwork_url: a.artworkUrl,
      position
    }))
  }

  songs(offset: number, limit: number, sort: LibrarySort = 'name'): Track[] {
    const rows = this.page<SongRow>('library_song', COLLECTION_SORTS.song[sort], offset, limit)
    return rows.map(toSong)
  }

  albums(offset: number, limit: number, sort: LibrarySort = 'name'): Album[] {
    const rows = this.page<AlbumRow>('library_album', COLLECTION_SORTS.album[sort], offset, limit)
    return rows.map(toAlbumRow)
  }

  // --- §3.6 Türler, Besteciler, Derlemeler -------------------------------------------------------

  /** Türler ve şarkı sayıları (ada göre). */
  genres(): { name: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT genre AS name, COUNT(*) AS count FROM library_song WHERE genre IS NOT NULL
         GROUP BY genre COLLATE NOCASE ORDER BY genre COLLATE NOCASE`
      )
      .all() as unknown as { name: string; count: number }[]
  }

  /** Bestecilerin şarkı sayıları (Apple dizesi kişi kişi ayrılmış). */
  composers(): { name: string; count: number }[] {
    const rows = this.db
      .prepare('SELECT composer FROM library_song WHERE composer IS NOT NULL')
      .all() as unknown as { composer: string }[]
    return countComposers(rows.map((r) => r.composer))
  }

  /** Bir türün ya da bestecinin şarkıları (sıralı, sayfalı) + toplam. */
  filteredSongs(
    filter: { genre: string } | { composer: string },
    offset: number,
    limit: number,
    sort: LibrarySort = 'name'
  ): { items: Track[]; total: number } {
    const order = COLLECTION_SORTS.song[sort]
    if ('genre' in filter) {
      const where = 'WHERE genre = ? COLLATE NOCASE'
      const { n } = this.db
        .prepare(`SELECT COUNT(*) AS n FROM library_song ${where}`)
        .get(filter.genre) as { n: number }
      const rows = this.db
        .prepare(`SELECT * FROM library_song ${where} ORDER BY ${order}, rowid LIMIT ? OFFSET ?`)
        .all(filter.genre, limit, offset) as unknown as SongRow[]
      return { items: rows.map(toSong), total: n }
    }
    // Besteci: önce kaba süzme (LIKE), sonra kişi kişi ayrılmış adla birebir.
    const key = filter.composer.toLocaleLowerCase()
    const rows = (
      this.db
        .prepare(
          `SELECT * FROM library_song WHERE composer LIKE ? ESCAPE '\\' ORDER BY ${order}, rowid`
        )
        .all(`%${likeEscape(filter.composer)}%`) as unknown as (SongRow & {
        composer: string | null
      })[]
    ).filter((r) => splitComposers(r.composer).some((name) => name.toLocaleLowerCase() === key))
    return { items: rows.slice(offset, offset + limit).map(toSong), total: rows.length }
  }

  /** Derleme albümleri (Apple katalog `isCompilation`) + toplam. */
  compilations(
    offset: number,
    limit: number,
    sort: LibrarySort = 'name'
  ): { items: Album[]; total: number } {
    const { n } = this.db
      .prepare('SELECT COUNT(*) AS n FROM library_album WHERE is_compilation = 1')
      .get() as { n: number }
    const rows = this.db
      .prepare(
        `SELECT * FROM library_album WHERE is_compilation = 1
         ORDER BY ${COLLECTION_SORTS.album[sort]}, rowid LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as unknown as AlbumRow[]
    return { items: rows.map(toAlbumRow), total: n }
  }

  artists(offset: number, limit: number, sort: LibrarySort = 'name'): Artist[] {
    return this.page<ArtistRow>('library_artist', COLLECTION_SORTS.artist[sort], offset, limit).map(
      (r) => ({
        id: r.id,
        name: r.name,
        artworkUrl: r.artwork_url
      })
    )
  }

  count(table: 'library_song' | 'library_album' | 'library_artist'): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  }

  /** Çıkış: yarım kalmış geçici tablolar da (kütüphane verisi taşır) silinir. */
  clear(): void {
    this.db.exec('DELETE FROM library_song; DELETE FROM library_album; DELETE FROM library_artist;')
    for (const table of TABLES) this.db.exec(`DROP TABLE IF EXISTS ${stageOf(table)}`)
  }

  /**
   * A4: büyük kütüphanede derin sayfa (OFFSET 49.900) için ertelenmiş birleştirme: atlama yalnızca
   * indeks üzerinden `rowid` ile yapılır (tablo satırı okunmaz), sonra sayfanın 100 satırı alınır.
   * `CROSS JOIN` döngü sırasını sabitler (dış döngü = sıralı alt sorgu); dışta ORDER BY yok, çünkü
   * geçici B-tree diskte açılır (Windows'ta ~4 ms). `rowid` eşit adlarda sırayı kararlı kılar.
   * Sonucun düz `ORDER BY … LIMIT/OFFSET` ile aynı olduğu testle doğrulanır (largeLibrary.test.ts).
   */
  private page<T>(table: string, orderBy: string, offset: number, limit: number): T[] {
    return this.db
      .prepare(
        `SELECT t.* FROM (SELECT rowid AS r FROM ${table} ORDER BY ${orderBy}, rowid LIMIT ? OFFSET ?) p
         CROSS JOIN ${table} t ON t.rowid = p.r`
      )
      .all(limit, offset) as unknown as T[]
  }

  private async replace<T>(
    table: Table,
    options: ReplaceOptions = {},
    items: readonly T[],
    row: (item: T, position: number) => Record<string, string | number | null>
  ): Promise<boolean> {
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) return false
    const insertSql = (target: string, sample: T): string => {
      const columns = Object.keys(row(sample, 0))
      return `INSERT OR REPLACE INTO ${target} (${columns.join(', ')}) VALUES (${columns.map((c) => `$${c}`).join(', ')})`
    }
    const chunkSize = options.chunkSize ?? STAGED_CHUNK_SIZE
    if (items.length <= chunkSize) {
      transaction(this.db, () => {
        this.db.exec(`DELETE FROM ${table}`)
        const first = items[0]
        if (first === undefined) return
        const insert = this.db.prepare(insertSql(table, first))
        items.forEach((item, i) => insert.run(row(item, i)))
      })
      return true
    }

    const stage = stageOf(table)
    const ddl = this.schemaSql('table', table)[0]
    if (!ddl) throw new Error(`${table} şeması yok`)
    const indexes = this.schemaSql('index', table)
    this.db.exec(`DROP TABLE IF EXISTS ${stage}`)
    this.db.exec(ddl.replace(new RegExp(`^CREATE TABLE\\s+"?${table}"?`), `CREATE TABLE ${stage}`))
    try {
      const insert = this.db.prepare(insertSql(stage, items[0]!))
      for (let start = 0; start < items.length; start += chunkSize) {
        transaction(this.db, () => {
          const end = Math.min(start + chunkSize, items.length)
          for (let i = start; i < end; i++) insert.run(row(items[i]!, i))
        })
        await (options.yieldFn ?? yieldToLoop)()
        if (!isCurrent()) {
          this.db.exec(`DROP TABLE IF EXISTS ${stage}`)
          return false
        }
      }
      transaction(this.db, () => {
        this.db.exec(`DROP TABLE ${table}`)
        this.db.exec(`ALTER TABLE ${stage} RENAME TO ${table}`)
        for (const sql of indexes) this.db.exec(sql)
      })
      return true
    } catch (err) {
      this.db.exec(`DROP TABLE IF EXISTS ${stage}`)
      throw err
    }
  }

  /** Tablonun / indekslerinin oluşturma SQL'i (otomatik PK indeksi hariç). */
  private schemaSql(type: 'table' | 'index', table: Table): string[] {
    const rows = this.db
      .prepare(
        'SELECT sql FROM sqlite_master WHERE type = ? AND tbl_name = ? AND sql IS NOT NULL ORDER BY name'
      )
      .all(type, table) as { sql: string }[]
    return rows.map((r) => r.sql)
  }
}

/** Parçalı yazmalarda parçalar arası bekleme (diğer worker istekleri araya girer). */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
