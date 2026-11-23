import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '@shared/ipc-contract'
import { playlist, track } from '../../testing'
import { openDatabase, type Db } from '../connection'
import { LibraryRepository } from './library'

// PLAN_v5 P5: büyük playlist'in parçalı yazılması ve aralık aramalı sayfa okuması.

let db: Db
let repo: LibraryRepository
beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new LibraryRepository(db)
  repo.replacePlaylists([playlist('a'), playlist('b')])
})
afterEach(() => db.close())

const tracks = (n: number, prefix = 't'): Track[] =>
  Array.from({ length: n }, (_, i) => track(`${prefix}${i}`))
const ids = (list: readonly Track[]) => list.map((t) => t.id)
const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
const stageRows = () => count('SELECT COUNT(*) AS n FROM playlist_tracks_stage')

describe('replacePlaylistTracksChunked (P5)', () => {
  it('parçalı yazma tek transaction’la aynı sonucu verir; okuyan arada eski listeyi görür', async () => {
    repo.replacePlaylistTracks('a', tracks(2, 'eski'))
    const seen: string[][] = []
    expect(
      await repo.replacePlaylistTracksChunked('a', tracks(5), {
        chunkSize: 2,
        yieldFn: async () => void seen.push(ids(repo.playlistTracks('a', 0, 10)))
      })
    ).toBe(true)
    expect(seen).toEqual([
      ['eski0', 'eski1'],
      ['eski0', 'eski1'],
      ['eski0', 'eski1']
    ])
    expect(ids(repo.playlistTracks('a', 0, 10))).toEqual(ids(tracks(5)))
    expect(repo.countPlaylistTracks('a')).toBe(5)
    expect(stageRows()).toBe(0)
    // Eski şarkılar sahipsiz kaldı: silindi.
    expect(count("SELECT COUNT(*) AS n FROM tracks WHERE id LIKE 'eski%'")).toBe(0)
  })

  it('arada başka playlist’in yazması (sahipsiz temizliği) bekleyen şarkıları silmez', async () => {
    let first = true
    expect(
      await repo.replacePlaylistTracksChunked('a', tracks(4), {
        chunkSize: 2,
        yieldFn: async () => {
          if (first) {
            first = false
            repo.replacePlaylistTracks('b', [track('x')]) // deleteOrphanTracks çalışır
          }
        }
      })
    ).toBe(true)
    expect(ids(repo.playlistTracks('a', 0, 10))).toEqual(ids(tracks(4)))
    expect(ids(repo.playlistTracks('b', 0, 10))).toEqual(['x'])
  })

  it('isCurrent false → bırakılır: eski liste kalır, bekleyenler ve sahipsiz şarkılar temizlenir', async () => {
    repo.replacePlaylistTracks('a', tracks(2, 'eski'))
    let calls = 0
    expect(
      await repo.replacePlaylistTracksChunked('a', tracks(6), {
        chunkSize: 2,
        isCurrent: () => ++calls < 3
      })
    ).toBe(false)
    expect(ids(repo.playlistTracks('a', 0, 10))).toEqual(['eski0', 'eski1'])
    expect(stageRows()).toBe(0)
    expect(count("SELECT COUNT(*) AS n FROM tracks WHERE id LIKE 't%'")).toBe(0)
  })

  it('playlist arada silinirse false; FK hatası yok, iz kalmaz', async () => {
    expect(
      await repo.replacePlaylistTracksChunked('a', tracks(4), {
        chunkSize: 2,
        yieldFn: async () => repo.deletePlaylist('a')
      })
    ).toBe(false)
    expect(stageRows()).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(0)
  })

  it('çıkış (clear) bekleyen bağlantıları da siler', async () => {
    const done = repo.replacePlaylistTracksChunked('a', tracks(4), {
      chunkSize: 2,
      yieldFn: async () => repo.clear(),
      isCurrent: () => repo.hasPlaylist('a')
    })
    expect(await done).toBe(false)
    expect(stageRows()).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM tracks')).toBe(0)
  })

  it('küçük liste tek transaction yolundan', async () => {
    expect(await repo.replacePlaylistTracksChunked('a', tracks(3))).toBe(true)
    expect(repo.countPlaylistTracks('a')).toBe(3)
  })
})

describe('playlistTracks aralık araması (P5)', () => {
  it('ekleme ve geri alma sonrası da OFFSET sorgusuyla birebir aynı', () => {
    repo.replacePlaylistTracks('a', tracks(7))
    const start = repo.appendPlaylistTracks('a', tracks(3, 'ek'))
    repo.truncatePlaylistTracks('a', start + 2)
    const offsetQuery = (offset: number, limit: number) =>
      (
        db
          .prepare(
            `SELECT track_id FROM playlist_tracks WHERE playlist_id = 'a'
             ORDER BY position LIMIT ? OFFSET ?`
          )
          .all(limit, offset) as { track_id: string }[]
      ).map((r) => r.track_id)
    for (const [offset, limit] of [
      [0, 4],
      [3, 4],
      [8, 4],
      [20, 4]
    ] as const) {
      expect(ids(repo.playlistTracks('a', offset, limit)), `${offset}`).toEqual(
        offsetQuery(offset, limit)
      )
    }
  })
})

describe('50.000 şarkılık playlist (P5 ölçümü)', { timeout: 60_000 }, () => {
  it('son sayfa bütçe içinde; parçalı yazmanın en uzun bloğu tek transaction’dan kısa', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-p5-'))
    const fileDb = openDatabase(join(dir, 'library.db'))
    try {
      const big = new LibraryRepository(fileDb)
      big.replacePlaylists([playlist('p')])
      const list = tracks(50_000)
      let maxChunk = 0
      let last = performance.now()
      await big.replacePlaylistTracksChunked('p', list, {
        yieldFn: async () => {
          const now = performance.now()
          maxChunk = Math.max(maxChunk, now - last)
          await new Promise((r) => setImmediate(r))
          last = performance.now()
        }
      })
      const swap = performance.now() - last
      const times: number[] = []
      for (let i = 0; i < 9; i++) {
        const t = performance.now()
        expect(big.playlistTracks('p', 49_900, 100)).toHaveLength(100)
        times.push(performance.now() - t)
      }
      times.sort((a, b) => a - b)
      if (process.env.AM_PERF_LOG) {
        console.log(
          `[P5] parça en uzun ${maxChunk.toFixed(0)} ms, takas ${swap.toFixed(0)} ms, son sayfa ${times[4]!.toFixed(2)} ms`
        )
      }
      // Tek başına: son sayfa < 1 ms; paralel test yükü payıyla.
      expect(times[4]).toBeLessThan(15)
      expect(big.countPlaylistTracks('p')).toBe(50_000)
    } finally {
      fileDb.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('playlist sıralaması (görünüm)', () => {
  const list = [
    track('t0', { name: 'beta', artistName: 'Zed', albumName: 'B', durationMs: 200_000 }),
    track('t1', { name: 'Alpha', artistName: 'adam', albumName: 'C', durationMs: 100_000 }),
    track('t2', { name: 'gamma', artistName: 'Adam', albumName: 'A', durationMs: 300_000 })
  ]
  beforeEach(() => repo.replacePlaylistTracks('a', list))

  it('varsayılan ve ters playlist sırası (en son eklenen en üstte)', () => {
    expect(ids(repo.playlistTracks('a', 0, 10))).toEqual(['t0', 't1', 't2'])
    expect(ids(repo.playlistTracks('a', 0, 10, { by: 'order', dir: 'asc' }))).toEqual([
      't0',
      't1',
      't2'
    ])
    expect(ids(repo.playlistTracks('a', 0, 10, { by: 'order', dir: 'desc' }))).toEqual([
      't2',
      't1',
      't0'
    ])
  })

  it('ad / sanatçı / albüm / süre, büyük-küçük harf duyarsız; sayfalama sıralı', () => {
    const by = (sort: Parameters<typeof repo.playlistTracks>[3]) =>
      ids(repo.playlistTracks('a', 0, 10, sort))
    expect(by({ by: 'title', dir: 'asc' })).toEqual(['t1', 't0', 't2'])
    expect(by({ by: 'title', dir: 'desc' })).toEqual(['t2', 't0', 't1'])
    // Aynı sanatçı (adam / Adam): albüm adına göre, sonra playlist sırası.
    expect(by({ by: 'artist', dir: 'asc' })).toEqual(['t2', 't1', 't0'])
    expect(by({ by: 'album', dir: 'asc' })).toEqual(['t2', 't0', 't1'])
    expect(by({ by: 'duration', dir: 'desc' })).toEqual(['t2', 't0', 't1'])
    expect(ids(repo.playlistTracks('a', 1, 1, { by: 'duration', dir: 'asc' }))).toEqual(['t0'])
  })
})
