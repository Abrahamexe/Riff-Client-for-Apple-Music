import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent, WorkerResponse } from '@shared/ipc-contract'
import { openDatabase, type Db } from './db/connection'
import { AppleMusicApi } from './net/appleApi'
import { createRpcHandler } from './rpc'
import { createWorkerServices } from './services'
import { fakeFetch, paged, playlistResource, songResource } from './testing'

// Uçtan uca (worker içi): RPC zarfı → sözleşme doğrulaması → servis → SQLite + sahte Apple API.

let db: Db
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  db = openDatabase(':memory:')
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

function setup(userToken: string | null = 'user-token') {
  const playlists = [playlistResource('p.1', 'Sabah'), playlistResource('p.2', 'Akşam')]
  const songs = Array.from({ length: 150 }, (_, i) => songResource(`i.${i}`))
  const { fetch, requests } = fakeFetch((url) => {
    if (url.pathname === '/v1/me/library/playlists') return paged(url, playlists)
    if (url.pathname === '/v1/me/library/playlists/p.1/tracks') return paged(url, songs)
    return { data: [] }
  })
  const events: WorkerEvent[] = []
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => 'dev',
    getUserToken: () => userToken,
    retry: { sleep: async () => {} }
  })
  const background = {
    get: vi.fn(),
    prefetch: vi.fn(),
    clear: vi.fn(),
    lyrics: vi.fn(),
    prefetchLyrics: vi.fn()
  }
  const services = createWorkerServices({ db, api, emit: (e) => events.push(e), background })
  const handle = createRpcHandler(services.handlers)
  let id = 0
  const call = async (method: string, params: unknown = {}) =>
    (await handle({ id: ++id, method, params })) as WorkerResponse
  return { call, handle, events, requests, services, background }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('worker RPC', () => {
  it('playlist’ler: önce boş (anında), senkronizasyon sonrası değişiklik bildirimi ve veri', async () => {
    const { call, events } = setup()
    expect((await call('getPlaylists')).result).toEqual({
      ok: true,
      value: { items: [], syncedAt: null }
    })
    await settle()
    expect(events).toEqual([{ event: 'library:changed', payload: { scope: 'playlists' } }])
    const res = await call('getPlaylists')
    expect(res.result.ok && (res.result.value as { items: { name: string }[] }).items).toEqual([
      expect.objectContaining({ name: 'Sabah' }),
      expect.objectContaining({ name: 'Akşam' })
    ])
  })

  it('binlerce şarkı için aralıklı okuma', async () => {
    const { call } = setup()
    await call('syncLibrary', { scope: 'playlistTracks', playlistId: 'p.1' })
    const res = await call('getPlaylistTracks', { playlistId: 'p.1', offset: 100, limit: 30 })
    expect(res.result).toMatchObject({ ok: true, value: { offset: 100, total: 150 } })
    const items = (res.result as { value: { items: { id: string }[] } }).value.items
    expect(items.map((t) => t.id)).toEqual(songs(100, 130))
  })

  it('liste içinde arama: eşleşenler sırayla, total eşleşen sayısı, sayfalama süzülmüş listede', async () => {
    const { call } = setup()
    await call('syncLibrary', { scope: 'playlistTracks', playlistId: 'p.1' })
    // "Şarkı i.12", "i.112", "i.120"…"i.129": büyük/küçük harf ve aksan duyarsız ("sarki").
    const res = await call('getPlaylistTracks', {
      playlistId: 'p.1',
      offset: 1,
      limit: 2,
      query: 'SARKI 12'
    })
    expect(res.result).toMatchObject({ ok: true, value: { offset: 1, total: 12 } })
    const items = (res.result as { value: { items: { id: string }[] } }).value.items
    expect(items.map((t) => t.id)).toEqual(['i.112', 'i.120'])
    // Boş (yalnızca boşluk) sorgu süzmez.
    const all = await call('getPlaylistTracks', { playlistId: 'p.1', limit: 1, query: '  ' })
    expect(all.result).toMatchObject({ ok: true, value: { total: 150 } })
  })

  it('büyük kütüphane (V5): 5.000 şarkılık playlist senkronize edilir, sayfalar doğru ve hızlı okunur', async () => {
    const many = Array.from({ length: 5_000 }, (_, i) => songResource(`i.${i}`))
    const { fetch, requests } = fakeFetch((url) => {
      if (url.pathname === '/v1/me/library/playlists')
        return paged(url, [playlistResource('p.big')])
      if (url.pathname === '/v1/me/library/playlists/p.big/tracks') return paged(url, many)
      return { data: [] }
    })
    const api = new AppleMusicApi({
      fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user',
      retry: { sleep: async () => {} }
    })
    const background = {
      get: vi.fn(),
      prefetch: vi.fn(),
      clear: vi.fn(),
      lyrics: vi.fn(),
      prefetchLyrics: vi.fn()
    }
    const services = createWorkerServices({ db, api, emit: () => {}, background })
    const handle = createRpcHandler(services.handlers)
    const call = async (method: string, params: unknown = {}) =>
      (await handle({ id: 1, method, params })) as WorkerResponse

    expect(
      (await call('syncLibrary', { scope: 'playlistTracks', playlistId: 'p.big' })).result
    ).toEqual({ ok: true, value: { changed: true } })
    // Apple sayfa boyutu 100: playlist listesi + 50 şarkı sayfası.
    expect(requests.filter((r) => r.url.pathname.endsWith('/tracks'))).toHaveLength(50)

    const started = performance.now()
    const last = await call('getPlaylistTracks', { playlistId: 'p.big', offset: 4_900, limit: 100 })
    const readMs = performance.now() - started
    expect(last.result).toMatchObject({ ok: true, value: { offset: 4_900, total: 5_000 } })
    const ids = (last.result as { value: { items: { id: string }[] } }).value.items.map((t) => t.id)
    expect(ids[0]).toBe('i.4900')
    expect(ids.at(-1)).toBe('i.4999')
    // Yerel okuma ağ beklemez; gerçek ölçüm (V5): 1.204 şarkılık playlist'te sayfa 1–3 ms.
    expect(readMs).toBeLessThan(250)
  })

  it('arka plan isteği (V8): ISRC yoksa katalog id’sinden çözülüp eklenir; varsa dokunulmaz', async () => {
    const { background } = setup()
    const isrc = { resolve: vi.fn(async () => 'GBUM71029604'), clear: vi.fn() }
    const api = new AppleMusicApi({
      fetch: fakeFetch(() => ({ data: [] })).fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user'
    })
    background.get.mockResolvedValue({ ok: true })
    const services = createWorkerServices({ db, api, emit: () => {}, background, isrc })
    const handle = createRpcHandler(services.handlers)
    const track = { title: 'Bohemian Rhapsody', artist: 'Queen', appleId: '1440806041' }
    await handle({ id: 1, method: 'getBackground', params: { track, lang: 'tr' } })
    expect(background.get).toHaveBeenLastCalledWith(
      { ...track, isrc: 'GBUM71029604' },
      'tr',
      undefined
    )
    await handle({ id: 2, method: 'prefetchBackground', params: { track, lang: 'tr' } })
    expect(background.prefetch).toHaveBeenLastCalledWith({ ...track, isrc: 'GBUM71029604' }, 'tr')

    const withOwn = { ...track, isrc: 'USAB10000001' }
    await handle({ id: 3, method: 'getBackground', params: { track: withOwn } })
    expect(isrc.resolve).toHaveBeenCalledTimes(2)
    expect(background.get).toHaveBeenLastCalledWith(withOwn, undefined, undefined)

    services.clearUserData()
    expect(isrc.clear).toHaveBeenCalledTimes(1)
  })

  it('player durumu kaydedilir ve geri okunur', async () => {
    const { call } = setup()
    const state = { queue: ['1', 'i.2'], position: 1, currentTime: 30 }
    expect((await call('savePlayerState', state)).result).toEqual({ ok: true, value: null })
    expect((await call('loadPlayerState')).result).toEqual({ ok: true, value: state })
  })

  it('çıkış (clearUserData) kütüphane, player durumu ve arka plan cache’lerini siler', async () => {
    const { call, services, background } = setup()
    await call('syncLibrary', { scope: 'playlists' })
    await call('savePlayerState', { queue: ['1'], position: 0, currentTime: 0 })
    services.clearUserData()
    expect((await call('loadPlayerState')).result).toEqual({ ok: true, value: null })
    const tables = ['playlists', 'tracks', 'playlist_tracks', 'player_state', 'sync_meta']
    for (const t of tables)
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 })
    expect(background.clear).toHaveBeenCalledTimes(1)
  })

  it('oturum yokken (çıkış sonrası, 2.7 Y2) kullanıcıya ait hiçbir şey yazılmaz', async () => {
    let signedIn = true
    const api = new AppleMusicApi({
      fetch: fakeFetch(() => ({ data: [] })).fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => (signedIn ? 'user' : null)
    })
    const background = {
      get: vi.fn(),
      prefetch: vi.fn(),
      clear: vi.fn(),
      lyrics: vi.fn(),
      prefetchLyrics: vi.fn()
    }
    const services = createWorkerServices({
      db,
      api,
      emit: () => {},
      background,
      isSignedIn: () => signedIn
    })
    const handle = createRpcHandler(services.handlers)
    const call = async (method: string, params: unknown = {}) =>
      ((await handle({ id: 1, method, params })) as WorkerResponse).result
    signedIn = false
    services.clearUserData()
    // Gecikmiş kayıt (durma olayı / kapanış flush'ı) silinen veriyi geri yazamaz.
    expect(await call('savePlayerState', { queue: ['1'], position: 0, currentTime: 9 })).toEqual({
      ok: true,
      value: null
    })
    expect(await call('loadPlayerState')).toEqual({ ok: true, value: null })
    const track = { title: 'Hurt', artist: 'Johnny Cash' }
    expect(await call('getBackground', { track })).toMatchObject({
      ok: false,
      error: { code: 'NOT_SIGNED_IN' }
    })
    await call('prefetchBackground', { track })
    expect(await call('getLyrics', { track })).toMatchObject({
      ok: false,
      error: { code: 'NOT_SIGNED_IN' }
    })
    expect(background.get).not.toHaveBeenCalled()
    expect(background.prefetch).not.toHaveBeenCalled()
    expect(background.lyrics).not.toHaveBeenCalled()
    await call('prefetchLyrics', { track })
    expect(background.prefetchLyrics).not.toHaveBeenCalled()
  })

  it('söz isteği (B11b) doğrulanır ve servise iletilir; bozuk istek reddedilir', async () => {
    const { call, background } = setup()
    const track = { title: 'Hurt', artist: 'Johnny Cash', durationMs: 218_000 }
    background.lyrics.mockResolvedValue({ kind: 'plain', lines: [{ timeMs: null, text: 'a' }] })
    expect((await call('getLyrics', { track })).result).toEqual({
      ok: true,
      value: { kind: 'plain', lines: [{ timeMs: null, text: 'a' }] }
    })
    expect(background.lyrics).toHaveBeenCalledWith(track)
    for (const bad of [{ track: { ...track, title: '' } }, { track, extra: 1 }, {}]) {
      expect((await call('getLyrics', bad)).result.ok).toBe(false)
    }
    expect(background.lyrics).toHaveBeenCalledTimes(1)
    expect((await call('prefetchLyrics', { track })).result).toEqual({ ok: true, value: null })
    expect(background.prefetchLyrics).toHaveBeenCalledWith(track)
  })

  it('arka plan istekleri sözleşmeyle doğrulanır ve servise iletilir (3.A7)', async () => {
    const { call, background } = setup()
    const track = { title: 'Hurt', artist: 'Johnny Cash', durationMs: 218_000 }
    background.get.mockResolvedValue({ key: 'k', data: {}, cached: false, stale: false })
    expect((await call('getBackground', { track, lang: 'tr' })).result.ok).toBe(true)
    expect(background.get).toHaveBeenCalledWith(track, 'tr', undefined)
    // requestId (aşama ilerlemesi için) servise iletilir; bozuk kimlik reddedilir (3.A8).
    await call('getBackground', { track, lang: 'tr', requestId: 'req-1' })
    expect(background.get).toHaveBeenLastCalledWith(track, 'tr', 'req-1')
    expect((await call('getBackground', { track, requestId: 'a b!' })).result.ok).toBe(false)
    expect((await call('prefetchBackground', { track })).result).toEqual({ ok: true, value: null })
    expect(background.prefetch).toHaveBeenCalledWith(track, undefined)
    // Geçersiz: boş başlık, fazladan alan, bozuk ISRC → servis çağrılmaz.
    for (const bad of [
      { track: { ...track, title: '' } },
      { track: { ...track, userId: 'x' } },
      { track: { ...track, isrc: 'DROP TABLE' } },
      { track, lang: 'de' }
    ]) {
      expect((await call('getBackground', bad)).result).toMatchObject({
        ok: false,
        error: { code: 'INVALID_PAYLOAD' }
      })
    }
    expect(background.get).toHaveBeenCalledTimes(2) // yalnızca iki geçerli çağrı
  })
})

describe('worker RPC: reddedilen istekler (1.3a)', () => {
  it.each<[string, string, unknown]>([
    ['bilinmeyen yöntem', 'dropDatabase', {}],
    ['prototip anahtarı', '__proto__', {}],
    ['toString', 'toString', {}]
  ])('%s → UNKNOWN_CHANNEL', async (_l, method, params) => {
    const { call } = setup()
    expect((await call(method, params)).result).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_CHANNEL' }
    })
  })

  it.each<[string, string, unknown]>([
    ['sayfa limiti çok büyük', 'getPlaylistTracks', { playlistId: 'p.1', limit: 100_000 }],
    ['arama çok uzun', 'getPlaylistTracks', { playlistId: 'p.1', query: 'a'.repeat(201) }],
    ['negatif offset', 'getPlaylistTracks', { playlistId: 'p.1', offset: -1 }],
    ['boş id', 'getPlaylistTracks', { playlistId: '' }],
    ['SQL enjeksiyonu denemesi alanı', 'getPlaylists', { orderBy: '1; DROP TABLE tracks' }],
    ['boş arama', 'searchLibrary', { term: '   ' }],
    ['geçersiz storefront', 'searchCatalog', { term: 'x', storefront: '../me' }],
    ['bilinmeyen kapsam', 'syncLibrary', { scope: 'everything' }],
    [
      'aşırı kuyruk',
      'savePlayerState',
      { queue: Array(5001).fill('1'), position: 0, currentTime: 0 }
    ],
    ['params dizi', 'getPlaylists', []],
    ['params null', 'getPlaylists', null]
  ])('%s → INVALID_PAYLOAD, ağa/DB’ye dokunulmaz', async (_l, method, params) => {
    const { call, requests } = setup()
    expect((await call(method, params)).result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(requests).toHaveLength(0)
  })

  it('params alanı olmayan istek reddedilir', async () => {
    const { handle } = setup()
    expect(await handle({ id: 7, method: 'getPlaylists' })).toMatchObject({
      id: 7,
      result: { ok: false, error: { code: 'INVALID_PAYLOAD' } }
    })
  })

  it('zarfı bozuk mesajlar yanıtsız yoksayılır', async () => {
    const { handle } = setup()
    for (const bad of [
      null,
      'x',
      { method: 'getPlaylists' },
      { id: -1, method: 'getPlaylists' },
      { id: 1.5, method: 'x' }
    ]) {
      expect(await handle(bad)).toBeNull()
    }
  })

  it('beklenmeyen hata ayrıntısı renderer’a sızdırılmaz', async () => {
    const { call } = setup()
    db.close() // SQLite hatası üret
    const res = await call('getPlaylists')
    expect(res.result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu.' }
    })
    db = openDatabase(':memory:') // afterEach için
  })
})

function songs(from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, i) => `i.${from + i}`)
}

describe('çıkış: silinen veri dosyada kalmaz (2.7 Y1)', () => {
  it('playlist adı ve kuyruk id’si library.db / -wal baytlarında bulunmaz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-wipe-'))
    const path = join(dir, 'library.db')
    const fileDb = openDatabase(path)
    try {
      const marker = 'MARKERPLAYLIST7f3a'
      const { fetch } = fakeFetch((url) =>
        url.pathname === '/v1/me/library/playlists'
          ? paged(url, [playlistResource('p.m', marker)])
          : { data: [] }
      )
      const api = new AppleMusicApi({
        fetch,
        getDeveloperToken: async () => 'dev',
        getUserToken: () => 'user',
        retry: { sleep: async () => {} }
      })
      const background = {
        get: vi.fn(),
        prefetch: vi.fn(),
        clear: vi.fn(),
        lyrics: vi.fn(),
        prefetchLyrics: vi.fn()
      }
      const services = createWorkerServices({ db: fileDb, api, emit: () => {}, background })
      const handle = createRpcHandler(services.handlers)
      await handle({ id: 1, method: 'syncLibrary', params: { scope: 'playlists' } })
      const state = { queue: ['MARKERQUEUE9c1d'], position: 0, currentTime: 0 }
      await handle({ id: 2, method: 'savePlayerState', params: state })
      const bytes = () =>
        ['', '-wal']
          .filter((s) => existsSync(path + s))
          .map((s) => readFileSync(path + s).toString('latin1'))
          .join('')
      // Ön koşul: işaretler gerçekten diske yazıldı (test anlamlı).
      fileDb.exec('PRAGMA wal_checkpoint(PASSIVE)')
      expect(bytes()).toContain(marker)
      services.clearUserData()
      const after = bytes()
      expect(after).not.toContain(marker)
      expect(after).not.toContain('MARKERQUEUE9c1d')
    } finally {
      fileDb.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('onSettings (Hızlı DNS gibi süreç düzeyi ayarlar, R2)', () => {
  it('açılışta ve her güncellemede güncel ayarla çağrılır', async () => {
    const api = new AppleMusicApi({
      fetch: fakeFetch(() => ({ data: [] })).fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user-token',
      retry: { sleep: async () => {} }
    })
    const background = {
      get: vi.fn(),
      prefetch: vi.fn(),
      clear: vi.fn(),
      lyrics: vi.fn(),
      prefetchLyrics: vi.fn()
    }
    const onSettings = vi.fn()
    const services = createWorkerServices({ db, api, emit: () => {}, background, onSettings })
    expect(onSettings).toHaveBeenCalledTimes(1)
    expect(onSettings.mock.lastCall?.[0].tweaks.fastDns).toBe(true)
    const handle = createRpcHandler(services.handlers)
    await handle({ id: 1, method: 'updateSettings', params: { tweaks: { fastDns: false } } })
    expect(onSettings).toHaveBeenCalledTimes(2)
    expect(onSettings.mock.lastCall?.[0].tweaks.fastDns).toBe(false)
  })
})

describe('çıkış: her tablo boşalır (R4)', () => {
  it('kullanıcı verisi tutan hiçbir tabloda satır kalmaz (yeni tablo eklenip unutulursa düşer)', async () => {
    const { call, services } = setup()
    await call('syncLibrary', { scope: 'playlists' })
    await call('getPlaylistTracks', { playlistId: 'p.1', offset: 0, limit: 10 })
    await call('getRecommendations', {})
    await call('getHeavyRotation', {})
    await call('addRecentSearch', { term: 'gizli arama' })
    await call('savePlayerState', { queue: ['i.1'], position: 0, currentTime: 3 })
    await call('updateSettings', { profile: { displayName: 'Ad Soyad' } })
    await settle()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name)
    expect(tables).toContain('catalog_cache')
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM catalog_cache').get() as { n: number }).n
    ).toBeGreaterThan(0)

    services.clearUserData()

    // `settings`: cihaz ayarları kalır (Apple Music gibi), kullanıcıya özel alanlar silinir.
    const left = tables
      .filter((t) => t !== 'settings' && !t.startsWith('sqlite_'))
      .map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n])
      .filter(([, n]) => n !== 0)
    expect(left).toEqual([])
    expect(JSON.stringify(db.prepare('SELECT * FROM settings').all())).not.toContain('Ad Soyad')
  })
})
