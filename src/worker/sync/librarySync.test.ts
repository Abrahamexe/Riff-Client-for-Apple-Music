import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Album, Artist, LibraryScope, Playlist, Track } from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'
import { openDatabase, type Db } from '../db/connection'
import { LibraryRepository } from '../db/repositories/library'
import { LibraryCollectionsRepository } from '../db/repositories/libraryCollections'
import { SyncMetaRepository } from '../db/repositories/syncMeta'
import { playlist, track } from '../testing'
import { LibrarySync } from './librarySync'

interface FakeApi {
  signedIn: boolean
  playlists: Playlist[] | CoreError
  tracks: Record<string, Track[]>
  getPlaylists: Mock<() => Promise<Playlist[]>>
  getPlaylistTracks: Mock<(id: string) => Promise<Track[]>>
  songs: Track[]
  albums: Album[]
  artists: Artist[]
  getLibrarySongs: Mock<() => Promise<Track[]>>
  getLibraryAlbums: Mock<() => Promise<Album[]>>
  getLibraryArtists: Mock<() => Promise<Artist[]>>
  isSignedIn: () => boolean
}

function fakeApi(): FakeApi {
  const api: FakeApi = {
    signedIn: true,
    playlists: [],
    tracks: {},
    getPlaylists: vi.fn(async () => {
      if (api.playlists instanceof CoreError) throw api.playlists
      return api.playlists
    }),
    getPlaylistTracks: vi.fn(async (id: string) => api.tracks[id] ?? []),
    songs: [],
    albums: [],
    artists: [],
    getLibrarySongs: vi.fn(async () => api.songs),
    getLibraryAlbums: vi.fn(async () => api.albums),
    getLibraryArtists: vi.fn(async () => api.artists),
    isSignedIn: () => api.signedIn
  }
  return api
}

let dir: string
const dbs: Db[] = []

function setup(
  api = fakeApi(),
  dbPath = ':memory:',
  clock = { t: 1_000_000 },
  ttlMs: number | (() => number) = 60_000
) {
  const db = openDatabase(dbPath)
  dbs.push(db)
  const changed: LibraryScope[] = []
  const errors: [LibraryScope, CoreError][] = []
  const sync = new LibrarySync({
    api: api,
    library: new LibraryRepository(db),
    collections: new LibraryCollectionsRepository(db),
    meta: new SyncMetaRepository(db),
    onChanged: (s) => changed.push(s),
    onError: (s, e) => errors.push([s, e]),
    now: () => clock.t,
    ttlMs
  })
  return { sync, api, db, changed, errors, clock }
}

/** Arka plan işlerinin (mikro-görevler) bitmesini bekler. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-sync-'))
})
afterEach(async () => {
  for (const db of dbs.splice(0)) if (db.isOpen) db.close()
  await rm(dir, { recursive: true, force: true })
})

describe('stale-while-revalidate', () => {
  it('ilk açılış: boş DB anında döner, arka planda senkronize edilir, değişiklik bildirilir', async () => {
    const { sync, api, changed } = setup()
    api.playlists = [playlist('a'), playlist('b')]
    expect(sync.getPlaylists()).toEqual({ items: [], syncedAt: null })
    await settle()
    expect(changed).toEqual([{ scope: 'playlists' }])
    expect(sync.getPlaylists().items.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('taze veri varken ağa çıkılmaz; TTL dolunca arka planda yenilenir', async () => {
    const { sync, api, clock } = setup()
    api.playlists = [playlist('a')]
    await sync.sync({ scope: 'playlists' })
    api.getPlaylists.mockClear()

    sync.getPlaylists()
    await settle()
    expect(api.getPlaylists).not.toHaveBeenCalled()

    clock.t += 60_000
    sync.getPlaylists()
    await settle()
    expect(api.getPlaylists).toHaveBeenCalledTimes(1)
  })

  it('ince ayar: TTL her okumada sorulur (ayar değişince hemen geçerli)', async () => {
    let ttl = 10 * 60_000
    const { sync, api, clock } = setup(fakeApi(), ':memory:', { t: 1_000_000 }, () => ttl)
    api.playlists = [playlist('a')]
    await sync.sync({ scope: 'playlists' })
    api.getPlaylists.mockClear()
    clock.t += 2 * 60_000
    sync.getPlaylists()
    await settle()
    expect(api.getPlaylists).not.toHaveBeenCalled()
    ttl = 60_000
    sync.getPlaylists()
    await settle()
    expect(api.getPlaylists).toHaveBeenCalledTimes(1)
  })

  it('içerik değişmediyse bildirim yapılmaz ama senkronizasyon zamanı güncellenir', async () => {
    const { sync, api, changed, clock } = setup()
    api.playlists = [playlist('a')]
    expect(await sync.sync({ scope: 'playlists' })).toEqual({ changed: true })
    clock.t += 5
    expect(await sync.sync({ scope: 'playlists' })).toEqual({ changed: false })
    expect(changed).toHaveLength(1)
    expect(sync.getPlaylists().syncedAt).toBe(clock.t)
  })

  it('giriş yapılmamışsa arka plan senkronizasyonu başlatılmaz', async () => {
    const { sync, api } = setup()
    api.signedIn = false
    sync.getPlaylists()
    await settle()
    expect(api.getPlaylists).not.toHaveBeenCalled()
  })

  it('eşzamanlı senkronizasyonlar tek istekte birleşir', async () => {
    const { sync, api } = setup()
    await Promise.all([sync.sync({ scope: 'playlists' }), sync.sync({ scope: 'playlists' })])
    expect(api.getPlaylists).toHaveBeenCalledTimes(1)
  })
})

describe('1.7a kabul kriterleri', () => {
  it('ikinci açılışta playlist’ler ve şarkılar ağ beklemeden görünür', async () => {
    const path = join(dir, 'library.db')
    const first = setup(fakeApi(), path)
    first.api.playlists = [playlist('p1'), playlist('p2')]
    first.api.tracks['p1'] = [track('1'), track('2'), track('3')]
    await first.sync.sync({ scope: 'playlistTracks', playlistId: 'p1' })
    first.db.close()

    // İkinci açılış: ağ hiç yanıt vermiyor (sonsuza dek bekliyor).
    const hanging = fakeApi()
    hanging.getPlaylists.mockImplementation(() => new Promise(() => {}))
    hanging.getPlaylistTracks.mockImplementation(() => new Promise(() => {}))
    const second = setup(hanging, path, { t: 1_000_000 + 10 * 60_000 })

    const playlists = second.sync.getPlaylists() // senkron: DB'den anında
    expect(playlists.items.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(playlists.syncedAt).toBe(1_000_000)
    const page = second.sync.getPlaylistTracks('p1', 1, 5)
    expect(page).toMatchObject({ offset: 1, total: 3 })
    expect(page.items.map((t) => t.id)).toEqual(['2', '3'])
  })

  it('internet kapalıyken kütüphane okunabilir; hata yalnızca bildirilir', async () => {
    const { sync, api, errors } = setup()
    api.playlists = [playlist('a')]
    await sync.sync({ scope: 'playlists' })

    api.playlists = new CoreError('OFFLINE', 'ağ yok')
    await expect(sync.sync({ scope: 'playlists' })).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(sync.getPlaylists().items.map((p) => p.id)).toEqual(['a'])

    // Arka plan yenilemesi (TTL dolmuş) hatası okuma sonucunu etkilemez, onError ile bildirilir.
    const stale = setup()
    stale.api.playlists = new CoreError('OFFLINE', 'ağ yok')
    expect(stale.sync.getPlaylists().items).toEqual([])
    await settle()
    expect(stale.errors.map(([s, e]) => [s.scope, e.code])).toEqual([['playlists', 'OFFLINE']])
    expect(errors).toEqual([])
  })
})

describe('playlist şarkıları', () => {
  it('bilinmeyen playlist için önce playlist listesi senkronize edilir', async () => {
    const { sync, api, changed } = setup()
    api.playlists = [playlist('p')]
    api.tracks['p'] = [track('1')]
    await sync.sync({ scope: 'playlistTracks', playlistId: 'p' })
    expect(changed).toEqual([{ scope: 'playlists' }, { scope: 'playlistTracks', playlistId: 'p' }])
    expect(sync.getPlaylistTracks('p').total).toBe(1)
  })

  it('kütüphanede olmayan playlist PLAYLIST_NOT_FOUND (LIB_001)', async () => {
    const { sync } = setup()
    await expect(sync.sync({ scope: 'playlistTracks', playlistId: 'yok' })).rejects.toMatchObject({
      code: 'PLAYLIST_NOT_FOUND',
      id: 'LIB_001'
    })
  })

  it('senkronizasyon sürerken playlist silinirse yazım yapılmaz', async () => {
    const { sync, api } = setup()
    api.playlists = [playlist('p')]
    await sync.sync({ scope: 'playlists' })
    let release!: (t: Track[]) => void
    api.getPlaylistTracks.mockImplementation(() => new Promise((r) => (release = r)))
    const pending = sync.sync({ scope: 'playlistTracks', playlistId: 'p' })
    await settle()
    api.playlists = []
    await sync.sync({ scope: 'playlists' })
    release([track('1')])
    expect(await pending).toEqual({ changed: false })
  })
})

describe('clear (çıkış)', () => {
  it('tüm yerel veriyi siler; süren senkronizasyon eski hesabın verisini yazmaz', async () => {
    const { sync, api, db } = setup()
    api.playlists = [playlist('a')]
    await sync.sync({ scope: 'playlists' })

    let release!: (p: Playlist[]) => void
    api.getPlaylists.mockImplementation(() => new Promise((r) => (release = r)))
    const pending = sync.sync({ scope: 'playlists' })
    sync.clear()
    release([playlist('eski-hesap')])
    expect(await pending).toEqual({ changed: false })
    expect(sync.getPlaylists()).toEqual({ items: [], syncedAt: null })
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_meta').get()).toEqual({ n: 0 })
  })
})

describe('kütüphane bölümleri: Şarkılar, Albümler, Sanatçılar (arayüz veri kapsamı)', () => {
  const album = (id: string, name: string, artistName: string): Album => ({
    id,
    name,
    artistName,
    trackCount: 10,
    playParams: { id, kind: 'album' },
    artworkUrl: null,
    ...(id === 'l.2' ? { explicit: true, releaseDate: '1975-11-21' } : {})
  })

  it('SWR: ilk okuma boş ve anında; senkron sonrası değişiklik bildirimi; sıralama ve sayfa', async () => {
    const api = fakeApi()
    api.songs = [
      track('i.b', { name: 'beta', artistName: 'Zed', explicit: true }),
      track('i.a', { name: 'Alfa', artistName: 'Yan' }),
      track('i.c', { name: 'çay', artistName: 'Ali' })
    ]
    api.albums = [album('l.1', 'Opera', 'Queen'), album('l.2', 'A Night', 'Queen')]
    api.artists = [
      { id: 'r.2', name: 'Zed', artworkUrl: null },
      { id: 'r.1', name: 'ABBA', artworkUrl: null }
    ]
    const { sync, changed } = setup(api)
    expect(sync.getLibrarySongs()).toEqual({ items: [], offset: 0, total: 0, syncedAt: null })
    sync.getLibraryAlbums()
    sync.getLibraryArtists()
    await settle()
    expect(changed).toEqual([{ scope: 'songs' }, { scope: 'albums' }, { scope: 'artists' }])

    const songs = sync.getLibrarySongs(0, 2, 'name')
    expect(songs.total).toBe(3)
    expect(songs.items.map((t) => t.name)).toEqual(['Alfa', 'beta'])
    expect(songs.items[1]).toMatchObject({ explicit: true })
    expect(sync.getLibrarySongs(0, 10, 'artist').items.map((t) => t.artistName)).toEqual([
      'Ali',
      'Yan',
      'Zed'
    ])
    expect(sync.getLibrarySongs(0, 10, 'recent').items.map((t) => t.id)).toEqual([
      'i.b',
      'i.a',
      'i.c'
    ])
    expect(sync.getLibraryAlbums(0, 10).items).toEqual([
      album('l.2', 'A Night', 'Queen'),
      album('l.1', 'Opera', 'Queen')
    ])
    expect(sync.getLibraryArtists().items.map((a) => a.name)).toEqual(['ABBA', 'Zed'])
  })

  it('içerik değişmediyse yazılmaz; çıkışta bölümler de silinir', async () => {
    const api = fakeApi()
    api.songs = [track('i.a')]
    const { sync, changed } = setup(api)
    await sync.sync({ scope: 'songs' })
    expect(await sync.sync({ scope: 'songs' })).toEqual({ changed: false })
    expect(changed).toHaveLength(1)
    sync.clear()
    expect(sync.getLibrarySongs().total).toBe(0)
  })
})
