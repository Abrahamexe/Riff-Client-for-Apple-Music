import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { playlist, track } from '../../testing'
import { openDatabase, type Db } from '../connection'
import { LibraryRepository } from './library'
import { PlayerStateRepository } from './playerState'
import { SyncMetaRepository } from './syncMeta'

let db: Db
let repo: LibraryRepository
beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new LibraryRepository(db)
})
afterEach(() => db.close())

describe('LibraryRepository', () => {
  it('playlist’leri API sırasıyla saklar ve okur', () => {
    repo.replacePlaylists([playlist('b', { canEdit: true }), playlist('a')])
    expect(repo.listPlaylists()).toEqual([playlist('b', { canEdit: true }), playlist('a')])
    expect(repo.hasPlaylist('a')).toBe(true)
    expect(repo.hasPlaylist('z')).toBe(false)
  })

  it('artık olmayan playlist’leri, şarkı bağlarını ve sahipsiz şarkıları siler', () => {
    repo.replacePlaylists([playlist('a'), playlist('b')])
    repo.replacePlaylistTracks('a', [track('1'), track('2')])
    repo.replacePlaylistTracks('b', [track('2')])
    repo.replacePlaylists([playlist('b')])
    expect(repo.listPlaylists().map((p) => p.id)).toEqual(['b'])
    expect(repo.countPlaylistTracks('a')).toBe(0)
    const ids = (db.prepare('SELECT id FROM tracks ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id
    )
    expect(ids).toEqual(['2'])
  })

  it('şarkıları sırayla saklar; aralıklı okuma ve toplam sayı', () => {
    repo.replacePlaylists([playlist('p')])
    const tracks = Array.from({ length: 250 }, (_, i) => track(`t${i}`))
    repo.replacePlaylistTracks('p', tracks)
    expect(repo.countPlaylistTracks('p')).toBe(250)
    expect(repo.playlistTracks('p', 0, 3)).toEqual(tracks.slice(0, 3))
    expect(repo.playlistTracks('p', 240, 100).map((t) => t.id)).toEqual(
      tracks.slice(240).map((t) => t.id)
    )
  })

  it('aynı şarkı playlist’te birden çok kez yer alabilir; playParams null korunur', () => {
    repo.replacePlaylists([playlist('p')])
    repo.replacePlaylistTracks('p', [track('1', { playParams: null }), track('1')])
    const out = repo.playlistTracks('p', 0, 10)
    expect(out).toHaveLength(2)
    expect(out[0]!.playParams).toEqual(track('1').playParams) // upsert: son hali geçerli
  })

  it('bilinmeyen playlist’e şarkı yazımı reddedilir ve hiçbir şey yazılmaz', () => {
    expect(() => repo.replacePlaylistTracks('yok', [track('1')])).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 0 })
  })

  it('clear tüm kütüphane verisini siler', () => {
    repo.replacePlaylists([playlist('p')])
    repo.replacePlaylistTracks('p', [track('1')])
    repo.clear()
    expect(repo.listPlaylists()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 0 })
  })
})

describe('SyncMetaRepository', () => {
  it('kaydeder, günceller, önekli kayıtları budar', () => {
    const meta = new SyncMetaRepository(db)
    expect(meta.get('playlists')).toBeNull()
    meta.set('playlists', { syncedAt: 1, contentHash: 'h1', itemCount: 2 })
    meta.set('playlists', { syncedAt: 2, contentHash: 'h2', itemCount: 3 })
    expect(meta.get('playlists')).toEqual({ syncedAt: 2, contentHash: 'h2', itemCount: 3 })
    meta.set('playlistTracks:a', { syncedAt: 1, contentHash: 'x', itemCount: 0 })
    meta.set('playlistTracks:b', { syncedAt: 1, contentHash: 'y', itemCount: 0 })
    meta.deleteWherePrefixNotIn('playlistTracks:', ['b'])
    expect(meta.get('playlistTracks:a')).toBeNull()
    expect(meta.get('playlistTracks:b')).not.toBeNull()
    expect(meta.get('playlists')).not.toBeNull()
  })
})

describe('PlayerStateRepository', () => {
  it('son durumu saklar ve geri yükler; bozuk kayıt null döner', () => {
    const repo = new PlayerStateRepository(db, () => 42)
    expect(repo.load()).toBeNull()
    repo.save({ queue: ['1', 'i.2'], position: 1, currentTime: 12.5 })
    expect(repo.load()).toEqual({ queue: ['1', 'i.2'], position: 1, currentTime: 12.5 })
    db.exec("UPDATE player_state SET queue = '{bozuk'")
    expect(repo.load()).toBeNull()
    repo.clear()
    expect(repo.load()).toBeNull()
  })
})
