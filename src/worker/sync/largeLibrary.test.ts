import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import { LibraryRepository } from '../db/repositories/library'
import {
  COLLECTION_SORTS,
  LibraryCollectionsRepository
} from '../db/repositories/libraryCollections'
import { SyncMetaRepository } from '../db/repositories/syncMeta'
import { AppleMusicApi } from '../net/appleApi'
import { fakeFetch } from '../testing'
import { LibrarySync } from './librarySync'

// PLAN_v5 A4: büyük kütüphane ölçümü (ağ yok; sahte Apple yanıtları, gerçek AppleMusicApi + diskteki
// SQLite). 50.000 şarkı (eski 20.000 sınırının üstü), 5.000 albüm, 2.000 sanatçı. Bütçeler bilerek
// geniş (CI/yavaş makine); ölçülen değerler docs/PERFORMANCE.md'de. Ayrıntılı çıktı: AM_PERF_LOG=1.

const SONGS = 50_000
const ALBUMS = 5_000
const ARTISTS = 2_000

// Belirlenimci, sıralamayı zorlayan adlar (Türkçe karakterler dahil).
const WORDS = ['aşk', 'Gece', 'yol', 'Deniz', 'ışık', 'Rüya', 'zaman', 'Kalp', 'şehir', 'Öykü']
const name = (i: number, salt: number): string =>
  `${WORDS[(i * 7 + salt) % WORDS.length]} ${WORDS[(i * 13 + salt * 3) % WORDS.length]} ${(i * 7919) % 100_003}`

const songRes = (i: number) => ({
  id: `i.${i}`,
  type: 'library-songs',
  attributes: {
    name: name(i, 1),
    artistName: name(i % ARTISTS, 2),
    albumName: name(i % ALBUMS, 3),
    durationInMillis: 120_000 + (i % 240) * 1000,
    playParams: { id: `i.${i}`, kind: 'song', catalogId: String(1_000_000 + i) },
    artwork: { url: `https://is1-ssl.mzstatic.com/image/thumb/Music/${i}/{w}x{h}bb.jpg` },
    ...(i % 3 === 0 ? { contentRating: 'explicit' } : {})
  }
})
const albumRes = (i: number) => ({
  id: `l.${i}`,
  type: 'library-albums',
  attributes: {
    name: name(i, 3),
    artistName: name(i % ARTISTS, 2),
    trackCount: 10,
    playParams: { id: `l.${i}`, kind: 'album' },
    artwork: { url: `https://is1-ssl.mzstatic.com/image/thumb/Music/a${i}/{w}x{h}bb.jpg` },
    releaseDate: '2020-01-01'
  }
})
const artistRes = (i: number) => ({
  id: `r.${i}`,
  type: 'library-artists',
  attributes: { name: name(i, 2) }
})

const DATA: Record<string, unknown[]> = {
  '/v1/me/library/songs': Array.from({ length: SONGS }, (_, i) => songRes(i)),
  '/v1/me/library/albums': Array.from({ length: ALBUMS }, (_, i) => albumRes(i)),
  '/v1/me/library/artists': Array.from({ length: ARTISTS }, (_, i) => artistRes(i))
}

// Bellek ölçümü için çöp toplayıcı (yalnızca bu test dosyasında).
setFlagsFromString('--expose_gc')
const gc = runInNewContext('gc') as () => void
const heapMb = (): number => Math.round(process.memoryUsage().heapUsed / 1024 / 1024)

const log = (...args: unknown[]): void => {
  if (process.env.AM_PERF_LOG) console.log('[A4]', ...args)
}

/** Ölçüm sırasında olay döngüsünün en uzun bloklanması (worker'da diğer istekleri geciktirir). */
function loopMonitor() {
  let last = performance.now()
  let maxGap = 0
  let peakHeap = process.memoryUsage().heapUsed
  const timer = setInterval(() => {
    const now = performance.now()
    maxGap = Math.max(maxGap, now - last)
    last = now
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
  }, 5)
  return {
    stop: () => {
      clearInterval(timer)
      // Son blok (ör. senkronun DB yazması) zamanlayıcı ateşlenmeden bitmiş olabilir.
      maxGap = Math.max(maxGap, performance.now() - last)
      return { maxGapMs: Math.round(maxGap), peakHeapMb: Math.round(peakHeap / 1024 / 1024) }
    }
  }
}

let dir: string
let db: Db
let sync: LibrarySync
let collections: LibraryCollectionsRepository

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-a4-'))
  db = openDatabase(join(dir, 'library.db'))
  collections = new LibraryCollectionsRepository(db)
  const { fetch: instant } = fakeFetch((url) => {
    const all = DATA[url.pathname] ?? []
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 100)
    return {
      data: all.slice(offset, offset + limit),
      ...(offset + limit < all.length ? { next: `${url.pathname}?offset=${offset + limit}` } : {}),
      meta: { total: all.length }
    }
  })
  // Gerçek ağ gibi her yanıt olay döngüsüne döner (yoksa izleme zamanlayıcısı hiç çalışmaz).
  const fetch: typeof globalThis.fetch = async (input, init) => {
    await new Promise((r) => setImmediate(r))
    return instant(input, init)
  }
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => 'dev',
    getUserToken: () => 'user'
  })
  sync = new LibrarySync({
    api,
    library: new LibraryRepository(db),
    collections,
    meta: new SyncMetaRepository(db),
    onChanged: () => {},
    onError: () => {}
  })
})

afterAll(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('büyük kütüphane (A4)', { timeout: 120_000 }, () => {
  it('50.000 şarkı, 5.000 albüm, 2.000 sanatçı eksiksiz senkronize edilir', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const results: Record<string, unknown> = {}
    for (const scope of ['songs', 'albums', 'artists'] as const) {
      gc()
      const before = heapMb()
      const monitor = loopMonitor()
      const t = performance.now()
      expect((await sync.sync({ scope })).changed).toBe(true)
      const ms = Math.round(performance.now() - t)
      const m = monitor.stop()
      gc()
      results[scope] = { ms, ...m, heapBeforeMb: before, heapAfterGcMb: heapMb() }
    }
    log('senkron', results)
    // Worker'ın en uzun tek bloğu (özet + takas): tek başına ~155 ms, `check`'in paralel yükünde
    // ~500 ms'ye çıkabiliyor. Tek transaction'a dönüş tek başına ≥ 1 sn; yapısal doğrulama
    // (parçalı yazma, takas) libraryCollections.test.ts'te.
    expect((results.songs as { maxGapMs: number }).maxGapMs).toBeLessThan(1_000)
    expect(collections.count('library_song')).toBe(SONGS)
    expect(collections.count('library_album')).toBe(ALBUMS)
    expect(collections.count('library_artist')).toBe(ARTISTS)
    // Geniş bütçe: 50.000 şarkı (500 sayfa, sahte ağ) < 20 sn.
    expect((results.songs as { ms: number }).ms).toBeLessThan(20_000)
  })

  it('değişmeyen ikinci senkron yazmaz (içerik özeti)', async () => {
    const t = performance.now()
    expect((await sync.sync({ scope: 'songs' })).changed).toBe(false)
    log('ikinci senkron ms', Math.round(performance.now() - t))
  })

  // Bütçe < 5 ms (tek başına ölçüm: en kötü ~4 ms, PERFORMANCE.md). `npm run check`'te diğer test
  // dosyaları paralel koştuğundan eşik 15 ms: indekssiz/geçici B-tree'ye dönüş (100–200 ms) yakalanır.
  it('sayfa okuma (100 satır) her sıralamada ve her konumda bütçe içinde (medyan)', () => {
    const out: Record<string, number> = {}
    for (const sort of ['name', 'artist', 'recent'] as const) {
      for (const offset of [0, 25_000, SONGS - 100]) {
        const times: number[] = []
        for (let i = 0; i < 15; i++) {
          const t = performance.now()
          const rows = collections.songs(offset, 100, sort)
          times.push(performance.now() - t)
          expect(rows).toHaveLength(100)
        }
        times.sort((a, b) => a - b)
        out[`${sort}@${offset}`] = Number(times[7]!.toFixed(2))
      }
    }
    log('sayfa okuma medyan ms', out)
    for (const [key, ms] of Object.entries(out)) expect(ms, key).toBeLessThan(15)
  })

  it('sayfalar düz ORDER BY … LIMIT/OFFSET sonucuyla birebir aynı (sıra, eşit adlar dahil)', () => {
    const tables = { song: 'library_song', album: 'library_album', artist: 'library_artist' }
    for (const [kind, sorts] of Object.entries(COLLECTION_SORTS)) {
      const table = tables[kind as keyof typeof tables]
      const read = { song: 'songs', album: 'albums', artist: 'artists' } as const
      for (const [sort, orderBy] of Object.entries(sorts)) {
        for (const offset of [0, 1_234, 1_900]) {
          const expected = (
            db
              .prepare(`SELECT id FROM ${table} ORDER BY ${orderBy}, rowid LIMIT 100 OFFSET ?`)
              .all(offset) as { id: string }[]
          ).map((r) => r.id)
          const page = collections[read[kind as keyof typeof read]](
            offset,
            100,
            sort as 'name' | 'artist' | 'recent'
          )
          expect(
            page.map((r) => r.id),
            `${table}.${sort}@${offset}`
          ).toEqual(expected)
        }
      }
    }
  })

  it('sayfa atlama sorguları yalnızca indeksi okur (geçici B-tree sıralaması yok)', () => {
    const plans: Record<string, string> = {}
    const tables = { song: 'library_song', album: 'library_album', artist: 'library_artist' }
    for (const [kind, sorts] of Object.entries(COLLECTION_SORTS)) {
      const table = tables[kind as keyof typeof tables]
      for (const [sort, orderBy] of Object.entries(sorts)) {
        // Sayfalamanın atlama sorgusu (libraryCollections `page`): yalnızca indeks.
        const rows = db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT rowid FROM ${table} ORDER BY ${orderBy}, rowid LIMIT 100 OFFSET 0`
          )
          .all() as { detail: string }[]
        plans[`${table}.${sort}`] = rows.map((r) => r.detail).join(' | ')
      }
    }
    log('sorgu planları', plans)
    for (const [key, plan] of Object.entries(plans)) {
      expect(plan, key).not.toContain('TEMP B-TREE')
      expect(plan, key).toContain('USING COVERING INDEX')
    }
  })

  it('içerik özeti ve tek transaction’da yer değiştirme maliyeti ölçülür', async () => {
    const items = collections.songs(0, SONGS, 'recent')
    let t = performance.now()
    createHash('sha256').update(JSON.stringify(items)).digest('hex')
    const hashMs = Math.round(performance.now() - t)
    t = performance.now()
    await collections.replaceSongs(items, { chunkSize: Infinity })
    const replaceMs = Math.round(performance.now() - t)
    log('50.000 şarkı: özet ms', hashMs, '· yer değiştirme ms', replaceMs)
    expect(collections.count('library_song')).toBe(SONGS)
    // Bilgi amaçlı (parçalı yazmanın neden gerektiği); bütçe değil.
    expect(hashMs + replaceMs).toBeLessThan(10_000)
  })

  // En sonda: veriyi siler.
  it('parçalı yazma sürerken çıkış → hiçbir şey yazılmaz, geçici tablo kalmaz', async () => {
    sync.clear()
    const stage = (): number =>
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'library_song_stage'")
          .get() as { n: number }
      ).n
    const running = sync.sync({ scope: 'songs' })
    for (let i = 0; i < 2_000 && stage() === 0; i++) await new Promise((r) => setTimeout(r, 5))
    expect(stage()).toBe(1)
    sync.clear()
    expect((await running).changed).toBe(false)
    expect(collections.count('library_song')).toBe(0)
    expect(stage()).toBe(0)
  })
})
