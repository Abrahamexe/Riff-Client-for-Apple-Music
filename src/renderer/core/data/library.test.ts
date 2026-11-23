import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkerApi } from '@shared/ipc-contract'
import { CoreError } from '../errors'
import { setGuardHandlers } from '../musickit/guard'
import { LibraryClient } from './library'

type Listener = (payload: never) => void

function fakeApi(overrides: Partial<Record<keyof WorkerApi, unknown>> = {}) {
  const listeners: Record<string, Listener> = {}
  const ok = (value: unknown) => vi.fn(async () => ({ ok: true, value }))
  const api = {
    getPlaylists: ok({ items: [], syncedAt: null }),
    getPlaylistTracks: ok({ items: [], offset: 0, total: 0, syncedAt: null }),
    syncLibrary: ok({ changed: true }),
    getRecentlyPlayed: ok([]),
    searchCatalog: ok({ songs: [], playlists: [] }),
    searchLibrary: ok({ songs: [], playlists: [] }),
    probeLibraryAccess: ok(2),
    savePlayerState: ok(null),
    loadPlayerState: ok(null),
    onLibraryChanged: vi.fn((fn: Listener) => ((listeners['changed'] = fn), () => {})),
    onSyncError: vi.fn((fn: Listener) => ((listeners['error'] = fn), () => {})),
    ...overrides
  }
  return { api: api as unknown as WorkerApi, raw: api, listeners }
}

const failWith = (code: string) =>
  vi.fn(async () => ({ ok: false, error: { code, message: `hata ${code}` } }))

afterEach(() => setGuardHandlers({}))

describe('LibraryClient', () => {
  it('parametreleri worker sözleşmesine uygun iletir', async () => {
    const { api, raw } = fakeApi()
    const client = new LibraryClient(api)
    await client.getPlaylistTracks('p.1', { offset: 100, limit: 50 })
    await client.searchCatalog('  queen ', { storefront: 'de' })
    await client.searchLibrary('x')
    await client.getRecentlyPlayed()
    expect(raw.getPlaylistTracks).toHaveBeenCalledWith({
      playlistId: 'p.1',
      offset: 100,
      limit: 50
    })
    expect(raw.searchCatalog).toHaveBeenCalledWith({ term: 'queen', storefront: 'de' })
    expect(raw.searchLibrary).toHaveBeenCalledWith({ term: 'x' })
    expect(raw.getRecentlyPlayed).toHaveBeenCalledWith({})
    expect(await client.probeLibraryAccess()).toBe(2)
  })

  it('sanatçı araması: katalog kapsamında; katalog sonucu yoksa boş', async () => {
    const artists = [{ id: '7', name: 'Metro Boomin', artworkUrl: null }]
    const search = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { catalog: { artists }, library: null } })
      .mockResolvedValueOnce({ ok: true, value: { catalog: null, library: null } })
    const { api } = fakeApi({ search })
    const client = new LibraryClient(api)
    expect(await client.searchArtists(' Metro Boomin ')).toEqual(artists)
    expect(search).toHaveBeenCalledWith({ term: 'Metro Boomin', scope: 'catalog', limit: 5 })
    expect(await client.searchArtists('x')).toEqual([])
    await expect(client.searchArtists('  ')).rejects.toBeInstanceOf(CoreError)
  })

  it('boş arama terimi worker’a gitmeden INVALID_ARGUMENT', async () => {
    const { api, raw } = fakeApi()
    const client = new LibraryClient(api)
    expect(() => client.searchCatalog('  ')).toThrow(CoreError)
    expect(raw.searchCatalog).not.toHaveBeenCalled()
  })

  it('worker hatası CoreError’a çevrilir; bilinmeyen kod UNKNOWN, katalog kodu korunur', async () => {
    const client = new LibraryClient(
      fakeApi({
        getPlaylists: failWith('OFFLINE'),
        probeLibraryAccess: failWith('SQLITE_BUSY'),
        getPlaylistTracks: failWith('INVALID_PAYLOAD')
      }).api
    )
    await expect(client.getPlaylists()).rejects.toMatchObject({ code: 'OFFLINE', retryable: true })
    await expect(client.probeLibraryAccess()).rejects.toMatchObject({ code: 'UNKNOWN' })
    await expect(client.getPlaylistTracks('p')).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      id: 'IPC_003'
    })
  })

  it('UNAUTHORIZED (doğrudan veya arka plan senkronizasyonundan) yeniden giriş akışını tetikler', async () => {
    const onUnauthorized = vi.fn()
    setGuardHandlers({ onUnauthorized })
    const { api, listeners } = fakeApi({ getPlaylists: failWith('UNAUTHORIZED') })
    const client = new LibraryClient(api)
    await expect(client.getPlaylists()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)

    const seen = vi.fn()
    client.onSyncError(seen)
    listeners['error']!({
      target: { scope: 'playlists' },
      error: { code: 'UNAUTHORIZED', message: 'x' }
    } as never)
    expect(onUnauthorized).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenCalledWith({ scope: 'playlists' }, expect.any(CoreError))
  })
})
