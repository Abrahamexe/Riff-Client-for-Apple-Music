import type { Playlist, Track, PlaylistSort } from '@shared/ipc-contract'
import { transaction, type Db } from '../connection'
import { STAGED_CHUNK_SIZE, yieldToLoop, type ReplaceOptions } from './libraryCollections'

/** Playlist sıralama alanı → sütunlar (beyaz liste; yön her sütuna uygulanır). */
const PLAYLIST_SORT_SQL: Record<PlaylistSort['by'], readonly string[]> = {
  order: ['pt.position'],
  title: ['t.name COLLATE NOCASE'],
  artist: ['t.artist_name COLLATE NOCASE', 't.album_name COLLATE NOCASE'],
  album: ['t.album_name COLLATE NOCASE'],
  duration: ['t.duration_ms']
}

// playlists, tracks, playlist_tracks tabloları. Tüm yazımlar transaction içinde ve hazırlanmış
// sorgularla yapılır; okumalar sayfalıdır (binlerce şarkılık playlist'ler için).

interface PlaylistRow {
  id: string
  name: string
  description: string
  can_edit: number
  artwork_url: string | null
}

interface TrackRow {
  id: string
  name: string
  artist_name: string
  album_name: string
  duration_ms: number | null
  play_params: string | null
  artwork_url: string | null
  explicit: number
}

const toPlaylist = (r: PlaylistRow): Playlist => ({
  id: r.id,
  name: r.name,
  description: r.description,
  canEdit: r.can_edit === 1,
  artworkUrl: r.artwork_url
})

function parsePlayParams(json: string | null): Track['playParams'] {
  if (json === null) return null
  try {
    const v = JSON.parse(json) as Track['playParams']
    return v && typeof v.id === 'string' && typeof v.kind === 'string' ? v : null
  } catch {
    return null
  }
}

const toTrack = (r: TrackRow): Track => ({
  id: r.id,
  name: r.name,
  artistName: r.artist_name,
  albumName: r.album_name,
  durationMs: r.duration_ms,
  playParams: parsePlayParams(r.play_params),
  artworkUrl: r.artwork_url,
  ...(r.explicit === 1 ? { explicit: true } : {})
})

export class LibraryRepository {
  constructor(private readonly db: Db) {}

  listPlaylists(): Playlist[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, description, can_edit, artwork_url FROM playlists ORDER BY position'
      )
      .all() as unknown as PlaylistRow[]
    return rows.map(toPlaylist)
  }

  hasPlaylist(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(id) !== undefined
  }

  /** Playlist listesini API'deki sırayla değiştirir; artık olmayanlar (ve şarkı bağları) silinir. */
  replacePlaylists(playlists: readonly Playlist[]): void {
    transaction(this.db, () => {
      const upsert = this.db.prepare(`
        INSERT INTO playlists (id, name, description, can_edit, artwork_url, position)
        VALUES ($id, $name, $description, $canEdit, $artworkUrl, $position)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, description = excluded.description, can_edit = excluded.can_edit,
          artwork_url = excluded.artwork_url, position = excluded.position`)
      playlists.forEach((p, position) =>
        upsert.run({
          id: p.id,
          name: p.name,
          description: p.description,
          canEdit: p.canEdit ? 1 : 0,
          artworkUrl: p.artworkUrl,
          position
        })
      )
      const ids = JSON.stringify(playlists.map((p) => p.id))
      this.db
        .prepare('DELETE FROM playlists WHERE id NOT IN (SELECT value FROM json_each(?))')
        .run(ids)
      this.deleteOrphanTracks()
    })
  }

  /** Bir playlist'in şarkılarını API'deki sırayla değiştirir (tek transaction). Playlist DB'de olmalıdır. */
  replacePlaylistTracks(playlistId: string, tracks: readonly Track[]): void {
    transaction(this.db, () => {
      const upsertTrack = this.upsertTrackStatement()
      const link = this.db.prepare(
        'INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)'
      )
      this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId)
      tracks.forEach((t, position) => {
        upsertTrack.run(trackParams(t))
        link.run(playlistId, position, t.id)
      })
      this.deleteOrphanTracks()
    })
  }

  /**
   * P5: büyük playlist (`chunkSize`'tan fazla şarkı) için parçalı yazma. Şarkılar ve bekleyen
   * bağlantılar (`playlist_tracks_stage`) parça parça, aralarda olay döngüsüne dönülerek yazılır;
   * playlist'in bağlantıları tek transaction'da değişir (okuyan yarım liste görmez). `isCurrent`
   * `false` olursa veya playlist bu arada silindiyse yazma bırakılır (`false`), eski liste kalır.
   * Küçük listede `replacePlaylistTracks` (tek transaction).
   */
  async replacePlaylistTracksChunked(
    playlistId: string,
    tracks: readonly Track[],
    options: ReplaceOptions = {}
  ): Promise<boolean> {
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) return false
    const chunkSize = options.chunkSize ?? STAGED_CHUNK_SIZE
    if (tracks.length <= chunkSize) {
      this.replacePlaylistTracks(playlistId, tracks)
      return true
    }
    const dropStage = (): void => {
      transaction(this.db, () => {
        this.db.prepare('DELETE FROM playlist_tracks_stage WHERE playlist_id = ?').run(playlistId)
        this.deleteOrphanTracks()
      })
    }
    dropStage()
    try {
      const upsertTrack = this.upsertTrackStatement()
      const stage = this.db.prepare(
        'INSERT INTO playlist_tracks_stage (playlist_id, position, track_id) VALUES (?, ?, ?)'
      )
      for (let start = 0; start < tracks.length; start += chunkSize) {
        transaction(this.db, () => {
          const end = Math.min(start + chunkSize, tracks.length)
          for (let i = start; i < end; i++) {
            const t = tracks[i]!
            upsertTrack.run(trackParams(t))
            stage.run(playlistId, i, t.id)
          }
        })
        await (options.yieldFn ?? yieldToLoop)()
        if (!isCurrent()) {
          dropStage()
          return false
        }
      }
      return transaction(this.db, () => {
        if (!this.hasPlaylist(playlistId)) {
          this.db.prepare('DELETE FROM playlist_tracks_stage WHERE playlist_id = ?').run(playlistId)
          this.deleteOrphanTracks()
          return false
        }
        this.db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlistId)
        this.db
          .prepare(
            `INSERT INTO playlist_tracks (playlist_id, position, track_id)
             SELECT playlist_id, position, track_id FROM playlist_tracks_stage WHERE playlist_id = ?`
          )
          .run(playlistId)
        this.db.prepare('DELETE FROM playlist_tracks_stage WHERE playlist_id = ?').run(playlistId)
        this.deleteOrphanTracks()
        return true
      })
    } catch (err) {
      dropStage()
      throw err
    }
  }

  /**
   * `offset`'ten başlayarak en fazla `limit` şarkı (playlist sırasıyla). P5: `position`'lar her
   * yazıcıda kesintisizdir (0..n-1; ekleme sondan, geri alma sondan keser), bu yüzden OFFSET
   * taraması yerine birincil anahtarda aralık araması (50.000 şarkıda son sayfa 19 ms → < 1 ms).
   */
  playlistTracks(playlistId: string, offset: number, limit: number, sort?: PlaylistSort): Track[] {
    if (sort && !(sort.by === 'order' && sort.dir === 'asc')) {
      return this.sortedPlaylistTracks(playlistId, offset, limit, sort)
    }
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name, t.artist_name, t.album_name, t.duration_ms, t.play_params, t.artwork_url,
           t.explicit
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND pt.position >= ? AND pt.position < ?
         ORDER BY pt.position`
      )
      .all(playlistId, offset, offset + limit) as unknown as TrackRow[]
    return rows.map(toTrack)
  }

  /**
   * Sıralı görünüm (yalnızca okuma): sütunlar `PLAYLIST_SORT_SQL` beyaz listesinden gelir (kullanıcı
   * metni SQL'e girmez); eşitlikte playlist sırası korunur. OFFSET taraması: playlist başına en fazla
   * birkaç bin satır.
   */
  private sortedPlaylistTracks(
    playlistId: string,
    offset: number,
    limit: number,
    sort: PlaylistSort
  ): Track[] {
    const dir = sort.dir === 'desc' ? 'DESC' : 'ASC'
    const order = PLAYLIST_SORT_SQL[sort.by].map((col) => `${col} ${dir}`).join(', ')
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name, t.artist_name, t.album_name, t.duration_ms, t.play_params, t.artwork_url,
           t.explicit
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY ${order}, pt.position ${dir}
         LIMIT ? OFFSET ?`
      )
      .all(playlistId, limit, offset) as unknown as TrackRow[]
    return rows.map(toTrack)
  }

  countPlaylistTracks(playlistId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?')
      .get(playlistId) as { n: number }
    return row.n
  }

  // --- 3.B2 iyimser yazma ---------------------------------------------------------------------

  /** Yeni playlist'i listenin başına ekler (Apple'daki gibi en yeni üstte). */
  insertPlaylistFirst(p: Playlist): void {
    const row = this.db.prepare('SELECT MIN(position) AS m FROM playlists').get() as {
      m: number | null
    }
    this.db
      .prepare(
        `INSERT INTO playlists (id, name, description, can_edit, artwork_url, position)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(p.id, p.name, p.description, p.canEdit ? 1 : 0, p.artworkUrl, (row.m ?? 0) - 1)
  }

  /** Geçici (yerel) playlist kimliğini Apple'ın verdiğiyle değiştirir; şarkı bağları taşınır. */
  replacePlaylistId(localId: string, real: Playlist): void {
    transaction(this.db, () => {
      const pos = this.db.prepare('SELECT position FROM playlists WHERE id = ?').get(localId) as
        { position: number } | undefined
      if (!pos) return
      this.db
        .prepare(
          `INSERT INTO playlists (id, name, description, can_edit, artwork_url, position)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`
        )
        .run(
          real.id,
          real.name,
          real.description,
          real.canEdit ? 1 : 0,
          real.artworkUrl,
          pos.position
        )
      this.db
        .prepare('UPDATE playlist_tracks SET playlist_id = ? WHERE playlist_id = ?')
        .run(real.id, localId)
      this.db.prepare('DELETE FROM playlists WHERE id = ?').run(localId)
    })
  }

  deletePlaylist(id: string): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
      this.deleteOrphanTracks()
    })
  }

  /** Playlist'in sonuna ekler; geri alma için ilk eklenen sıra numarasını döner. */
  appendPlaylistTracks(playlistId: string, tracks: readonly Track[]): number {
    return transaction(this.db, () => {
      const start = this.countPlaylistTracks(playlistId)
      const upsertTrack = this.db.prepare(`
        INSERT INTO tracks (id, name, artist_name, album_name, duration_ms, play_params, artwork_url, explicit)
        VALUES ($id, $name, $artistName, $albumName, $durationMs, $playParams, $artworkUrl, $explicit)
        ON CONFLICT(id) DO NOTHING`)
      const link = this.db.prepare(
        'INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)'
      )
      tracks.forEach((t, i) => {
        upsertTrack.run({
          id: t.id,
          name: t.name,
          artistName: t.artistName,
          albumName: t.albumName,
          durationMs: t.durationMs,
          playParams: t.playParams ? JSON.stringify(t.playParams) : null,
          artworkUrl: t.artworkUrl,
          explicit: t.explicit ? 1 : 0
        })
        link.run(playlistId, start + i, t.id)
      })
      return start
    })
  }

  /** Geri alma: `fromPosition` ve sonrasındaki şarkı bağlarını siler. */
  truncatePlaylistTracks(playlistId: string, fromPosition: number): void {
    transaction(this.db, () => {
      this.db
        .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position >= ?')
        .run(playlistId, fromPosition)
      this.deleteOrphanTracks()
    })
  }

  clear(): void {
    transaction(this.db, () => {
      this.db.exec(
        'DELETE FROM playlist_tracks_stage; DELETE FROM playlist_tracks; DELETE FROM playlists; DELETE FROM tracks;'
      )
    })
  }

  private upsertTrackStatement() {
    return this.db.prepare(`
      INSERT INTO tracks (id, name, artist_name, album_name, duration_ms, play_params, artwork_url, explicit)
      VALUES ($id, $name, $artistName, $albumName, $durationMs, $playParams, $artworkUrl, $explicit)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, artist_name = excluded.artist_name, album_name = excluded.album_name,
        duration_ms = excluded.duration_ms, play_params = excluded.play_params,
        artwork_url = excluded.artwork_url, explicit = excluded.explicit`)
  }

  /** Hiçbir playlist'te (bekleyen parçalı yazmalar dahil) olmayan şarkılar silinir. */
  private deleteOrphanTracks(): void {
    this.db.exec(
      `DELETE FROM tracks WHERE id NOT IN (
         SELECT track_id FROM playlist_tracks UNION SELECT track_id FROM playlist_tracks_stage)`
    )
  }
}

function trackParams(t: Track) {
  return {
    id: t.id,
    name: t.name,
    artistName: t.artistName,
    albumName: t.albumName,
    durationMs: t.durationMs,
    playParams: t.playParams ? JSON.stringify(t.playParams) : null,
    artworkUrl: t.artworkUrl,
    explicit: t.explicit ? 1 : 0
  }
}
