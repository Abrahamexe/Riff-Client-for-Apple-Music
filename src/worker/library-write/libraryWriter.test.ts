import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent } from '@shared/ipc-contract'
import { openDatabase, type Db } from '../db/connection'
import { LibraryRepository } from '../db/repositories/library'
import { SyncMetaRepository } from '../db/repositories/syncMeta'
import { AppleMusicApi } from '../net/appleApi'
import { keyOf } from '../sync/librarySync'
import { playlist, track } from '../testing'
import { LOCAL_PLAYLIST_PREFIX, LibraryWriter, MAX_ATTEMPTS } from './libraryWriter'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

interface Sent {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}

/** Sahte Apple: `mode` ağ yok / kalıcı hata / başarılı; yapılan yazma istekleri kaydedilir. */
function setup() {
  const state = { mode: 'ok' as 'ok' | 'offline' | 'reject', createdId: 'p.NEW1' }
  const sent: Sent[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (state.mode === 'offline') throw new TypeError('fetch failed')
    const method = init?.method ?? 'GET'
    sent.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    })
    if (state.mode === 'reject') return new Response('', { status: 400 })
    if (method === 'GET' && url.pathname.startsWith('/v1/me/ratings/')) {
      return Response.json({ data: [{ id: 's1', type: 'ratings', attributes: { value: -1 } }] })
    }
    if (method === 'POST' && url.pathname === '/v1/me/library/playlists') {
      const name = (JSON.parse(init!.body as string) as { attributes: { name: string } }).attributes
        .name
      return Response.json(
        {
          data: [
            { id: state.createdId, type: 'library-playlists', attributes: { name, canEdit: true } }
          ]
        },
        { status: 201 }
      )
    }
    return new Response(null, {
      status: method === 'POST' && url.pathname.endsWith('/tracks') ? 204 : 202
    })
  }) as typeof globalThis.fetch
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => 'dev',
    getUserToken: () => 'user'
  })
  const library = new LibraryRepository(db)
  const meta = new SyncMetaRepository(db)
  const events: WorkerEvent[] = []
  const clock = { t: 1_000_000 }
  const writer = new LibraryWriter({
    db,
    api,
    library,
    meta,
    emit: (e) => events.push(e),
    now: () => clock.t,
    settleMs: 30_000,
    retryIntervalMs: 0
  })
  const pendingCount = () =>
    (db.prepare('SELECT COUNT(*) AS n FROM pending_writes').get() as { n: number }).n
  return { writer, library, meta, sent, state, events, clock, pendingCount }
}

const songs = [
  track('1440806041', { playParams: { id: '1440806041', kind: 'song' } }),
  track('i.lib1')
]

describe('LibraryWriter (3.B2)', () => {
  it('playlist oluşturma: yerelde anında görünür, Apple’ın kimliğiyle değişir; istek gövdesi doğru', async () => {
    const { writer, library, sent, events } = setup()
    library.replacePlaylists([playlist('p.old')])
    const done = writer.createPlaylist('Yolculuk', 'açıklama', songs)
    // Ağ yanıtı gelmeden yerel liste güncellendi (iyimser).
    expect(library.listPlaylists()[0]!.id.startsWith(LOCAL_PLAYLIST_PREFIX)).toBe(true)
    expect(events[0]).toEqual({ event: 'library:changed', payload: { scope: 'playlists' } })
    const res = await done
    expect(res).toMatchObject({ queued: false, playlist: { id: 'p.NEW1', name: 'Yolculuk' } })
    expect(library.listPlaylists().map((p) => p.id)).toEqual(['p.NEW1', 'p.old'])
    expect(library.playlistTracks('p.NEW1', 0, 10).map((t) => t.id)).toEqual([
      '1440806041',
      'i.lib1'
    ])
    expect(sent[0]).toMatchObject({
      method: 'POST',
      path: '/v1/me/library/playlists',
      body: {
        attributes: { name: 'Yolculuk', description: 'açıklama' },
        relationships: {
          tracks: {
            data: [
              { id: '1440806041', type: 'songs' },
              { id: 'i.lib1', type: 'library-songs' }
            ]
          }
        }
      }
    })
  })

  it('Apple reddederse yerel değişiklik geri alınır ve hata döner', async () => {
    const { writer, library, state, pendingCount } = setup()
    library.replacePlaylists([playlist('p.old')])
    state.mode = 'reject'
    await expect(writer.createPlaylist('X')).rejects.toBeTruthy()
    expect(library.listPlaylists().map((p) => p.id)).toEqual(['p.old'])
    await expect(writer.addTracksToPlaylist('p.old', songs)).rejects.toBeTruthy()
    expect(library.countPlaylistTracks('p.old')).toBe(0)
    expect(pendingCount()).toBe(0)
  })

  it('çevrimdışı: kuyruğa alınır, yerel durum korunur; bağlanınca SIRAYLA gönderilir (yerel playlist’e ekleme dahil)', async () => {
    const { writer, library, state, sent, pendingCount } = setup()
    state.mode = 'offline'
    const created = await writer.createPlaylist('Çevrimdışı')
    expect(created.queued).toBe(true)
    const localId = created.playlist.id
    expect(await writer.addTracksToPlaylist(localId, [songs[0]!])).toEqual({ queued: true })
    expect(await writer.setRating('songs', '1440806041', 1)).toEqual({ queued: true })
    expect(pendingCount()).toBe(3)
    expect(library.countPlaylistTracks(localId)).toBe(1)

    state.mode = 'ok'
    expect((await writer.flush()).remaining).toBe(0)
    expect(pendingCount()).toBe(0)
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'POST /v1/me/library/playlists',
      'POST /v1/me/library/playlists/p.NEW1/tracks',
      'PUT /v1/me/ratings/songs/1440806041'
    ])
    expect(library.hasPlaylist(localId)).toBe(false)
    expect(library.playlistTracks('p.NEW1', 0, 10).map((t) => t.id)).toEqual(['1440806041'])
  })

  it('kuyruk çok kez başarısız olursa vazgeçilir: geri alma + onLibraryWriteFailed', async () => {
    const { writer, library, state, events, pendingCount } = setup()
    state.mode = 'offline'
    const { playlist: local } = await writer.createPlaylist('Gitmeyen')
    await writer.addTracksToPlaylist(local.id, [songs[0]!])
    for (let i = 0; i < MAX_ATTEMPTS; i++) await writer.flush()
    expect(pendingCount()).toBe(0) // bağımlı ekleme de düştü
    expect(library.hasPlaylist(local.id)).toBe(false)
    expect(events.filter((e) => e.event === 'library:writeFailed')).toEqual([
      {
        event: 'library:writeFailed',
        payload: {
          op: 'createPlaylist',
          error: expect.objectContaining({ code: 'LIBRARY_WRITE_FAILED' })
        }
      }
    ])
  })

  it('playlist’e eklerken kütüphaneye ekle: yalnızca katalog id’leri ayrıca eklenir', async () => {
    const { writer, library, sent } = setup()
    library.replacePlaylists([playlist('p.1')])
    const withCatalog = track('i.lib2', {
      playParams: { id: 'i.lib2', kind: 'song', catalogId: '555' }
    })
    await writer.addTracksToPlaylist(
      'p.1',
      [songs[0]!, withCatalog, track('i.nocat', { playParams: null })],
      true
    )
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'POST /v1/me/library/playlists/p.1/tracks',
      'POST /v1/me/library'
    ])
    expect(sent[1]!.query).toEqual({ 'ids[songs]': '1440806041,555' })
  })

  it('kütüphaneye / favorilere ekleme tür parametreleriyle; favoride kütüphane seçeneği', async () => {
    const { writer, sent } = setup()
    await writer.addToLibrary({ songs: ['1', '2'], albums: ['3'] })
    await writer.addToFavorites({ songs: ['1'] }, true)
    expect(sent.map((s) => [s.method, s.path, s.query])).toEqual([
      ['POST', '/v1/me/library', { 'ids[songs]': '1,2', 'ids[albums]': '3' }],
      ['POST', '/v1/me/favorites', { 'ids[songs]': '1' }],
      ['POST', '/v1/me/library', { 'ids[songs]': '1' }]
    ])
  })

  it('puan: iyimser, kaldırma DELETE; Apple’dan yenileme bekleyen yazmayı ezmez', async () => {
    const { writer, sent, state } = setup()
    await writer.setRating('songs', 's1', 1)
    expect(sent.at(-1)).toMatchObject({
      method: 'PUT',
      body: { type: 'ratings', attributes: { value: 1 } }
    })
    await writer.setRating('songs', 's1', null)
    expect(sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/v1/me/ratings/songs/s1' })
    // Apple'da -1: yenileme yerel kopyayı günceller.
    expect(await writer.getRatings('songs', ['s1', 's2'], true)).toEqual([
      { id: 's1', value: -1 },
      { id: 's2', value: null }
    ])
    // Çevrimdışı sevme bekliyor: Apple'daki -1 yerel 1'i ezmez.
    state.mode = 'offline'
    await writer.setRating('songs', 's1', 1)
    state.mode = 'ok'
    db.exec('UPDATE pending_writes SET attempts = 0') // flush'tan önce yenileme
    vi.spyOn(writer, 'flush').mockResolvedValue({ sent: 0, remaining: 1 })
    expect(await writer.getRatings('songs', ['s1'], true)).toEqual([{ id: 's1', value: 1 }])
  })

  it('reddedilen puan önceki değere döner', async () => {
    const { writer, state } = setup()
    await writer.setRating('songs', 's1', -1)
    state.mode = 'reject'
    await expect(writer.setRating('songs', 's1', 1)).rejects.toBeTruthy()
    expect(await writer.getRatings('songs', ['s1'])).toEqual([{ id: 's1', value: -1 }])
  })

  it('çakışma: yazma bekliyorken ve tamamlandıktan sonra bir süre kapsam senkronda korunur', async () => {
    const { writer, library, meta, state, clock } = setup()
    library.replacePlaylists([playlist('p.1')])
    meta.set(keyOf({ scope: 'playlistTracks', playlistId: 'p.1' }), {
      syncedAt: clock.t,
      contentHash: 'h',
      itemCount: 0
    })
    const key = keyOf({ scope: 'playlistTracks', playlistId: 'p.1' })
    state.mode = 'offline'
    await writer.addTracksToPlaylist('p.1', [songs[0]!])
    expect(writer.isHeld(key)).toBe(true)
    state.mode = 'ok'
    await writer.flush()
    expect(writer.isHeld(key)).toBe(true) // Apple gecikmesi için bekleme
    clock.t += 30_001
    expect(writer.isHeld(key)).toBe(false)
    expect(meta.get(key)?.syncedAt).toBe(0) // eskimiş sayıldı: sonraki okuma senkronize eder
  })

  it('çıkış: kuyruk ve puanlar silinir', async () => {
    const { writer, state, pendingCount } = setup()
    state.mode = 'offline'
    await writer.addToLibrary({ songs: ['1'] })
    await writer.setRating('songs', 's1', 1)
    writer.clear()
    expect(pendingCount()).toBe(0)
    expect(await writer.getRatings('songs', ['s1'])).toEqual([{ id: 's1', value: null }])
  })
})
