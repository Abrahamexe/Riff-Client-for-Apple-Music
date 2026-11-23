import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeContract } from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'
import { CdmStatusTracker } from './cdm'
import {
  createIpcDispatcher,
  createIpcHandlers,
  registerIpcHandlers,
  type IpcHandlers,
  type SenderFrame
} from './ipc'
import { SecureStoreError, type SecureStore } from './storage/secureStore'
import { TokenError, type TokenProvider } from './token/TokenProvider'

const SECRET = 'dummy-user-token-SECRET'
const frame = (url: string, parent: unknown = null, routingId = 1): SenderFrame => ({
  url,
  parent,
  processId: 7,
  routingId,
  postMessage: vi.fn()
})
const trusted = frame('app://renderer/index.html')
const ev = (senderFrame: SenderFrame | null = trusted) => ({ senderFrame })

// header.payload.signature; payload = {"exp":1700000000}
const FAKE_JWT = `e30.${Buffer.from('{"exp":1700000000}').toString('base64url')}.sig`

function setup(overrides: Partial<IpcHandlers> = {}) {
  const store = {
    load: vi.fn(async () => SECRET),
    save: vi.fn<(value: string) => Promise<void>>(async () => {}),
    clear: vi.fn(async () => {})
  }
  const tokenProvider: TokenProvider = {
    getDeveloperToken: vi.fn(async () => FAKE_JWT),
    invalidate: vi.fn()
  }
  const authorizer = { authorize: vi.fn(async () => ({ token: SECRET, restricted: false })) }
  const localFiles = { clear: vi.fn(async () => {}) }
  const worker = {
    connect: vi.fn(async () => {}),
    setUserToken: vi.fn(),
    clearUserData: vi.fn(async () => {})
  }
  const hub = {
    publishState: vi.fn(),
    publishTime: vi.fn(),
    snapshot: vi.fn(() => ({ state: null, time: { currentTime: 0, duration: 0 } })),
    command: vi.fn(),
    reset: vi.fn()
  }
  // Ana pencerenin ana çerçevesi: processId 7, routingId 1 (trusted).
  const windows = {
    isMainWindowFrame: vi.fn((f: { processId: number; routingId: number }) => f.routingId === 1),
    openMiniPlayer: vi.fn(),
    // MiniPlayer penceresi: routingId 2.
    closeMiniPlayer: vi.fn((f: { routingId: number }) => f.routingId === 2),
    // Kayıtlı pencerelerimiz: ana (routingId 1) ve yardımcı (2); başkası (ör. Apple girişi) değil.
    controlWindow: vi.fn((f: { routingId: number }) => f.routingId === 1 || f.routingId === 2),
    windowState: vi.fn((f: { routingId: number }) =>
      f.routingId <= 2 ? { maximized: false, focused: true } : null
    )
  }
  const openExternal = vi.fn<(url: string) => Promise<void>>(async () => {})
  const writeClipboard = vi.fn<(text: string) => Promise<void>>(async () => {})
  const warmupPlayback = vi.fn()
  const handlers = {
    ...createIpcHandlers({
      tokenProvider,
      authorizer,
      localFiles,
      openExternal,
      writeClipboard,
      warmupPlayback,
      userTokenStore: store as unknown as SecureStore,
      cdm: new CdmStatusTracker(),
      worker,
      hub,
      windows
    }),
    ...overrides
  }
  return {
    dispatch: createIpcDispatcher(handlers),
    handlers,
    store,
    tokenProvider,
    authorizer,
    localFiles,
    worker,
    hub,
    windows,
    openExternal,
    writeClipboard,
    warmupPlayback
  }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const HUB_STATE = {
  playbackState: 'playing',
  nowPlaying: null,
  volume: 0.5,
  shuffle: false,
  repeat: 'none',
  queue: { ids: ['1', '2'], position: 1, autoplayIndex: null }
} as const

describe('player-hub kanalları (1.8a)', () => {
  it('ana pencere durum ve konum yayınlayabilir', async () => {
    const { dispatch, hub } = setup()
    expect(await dispatch('player:publishState', ev(), [HUB_STATE])).toEqual({
      ok: true,
      value: null
    })
    const time = { currentTime: 3, duration: 200 }
    expect(await dispatch('player:publishTime', ev(), [time])).toEqual({ ok: true, value: null })
    expect(hub.publishState).toHaveBeenCalledWith(HUB_STATE)
    expect(hub.publishTime).toHaveBeenCalledWith(time)
  })

  it('yardımcı pencere yayın yapamaz (FORBIDDEN) ama durum okuyup komut gönderebilir', async () => {
    const { dispatch, hub } = setup()
    const aux = ev(frame('app://renderer/mini.html', null, 2))
    expect(await dispatch('player:publishState', aux, [HUB_STATE])).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
    expect(hub.publishState).not.toHaveBeenCalled()
    expect(await dispatch('player:getState', aux, [])).toMatchObject({ ok: true })
    expect(await dispatch('player:command', aux, [{ type: 'seek', seconds: 30 }])).toEqual({
      ok: true,
      value: null
    })
    expect(hub.command).toHaveBeenCalledWith({ type: 'seek', seconds: 30 })
  })

  it.each([
    [{ type: 'eval', code: 'x' }],
    [{ type: 'seek', seconds: -1 }],
    [{ type: 'setVolume', volume: 2 }],
    [{ type: 'play', extra: 1 }],
    ['play']
  ])('geçersiz komut reddedilir: %j', async (command) => {
    const { dispatch, hub } = setup()
    expect(await dispatch('player:command', ev(), [command])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(hub.command).not.toHaveBeenCalled()
  })

  it('geçersiz durum (https olmayan kapak, aşırı kuyruk) reddedilir', async () => {
    const { dispatch } = setup()
    const badArt = {
      ...HUB_STATE,
      nowPlaying: {
        id: '1',
        title: 't',
        artist: 'a',
        album: 'b',
        artworkUrl: 'javascript:alert(1)',
        durationSec: 1,
        playbackType: 'encryptedFull'
      }
    }
    const bigQueue = {
      ...HUB_STATE,
      queue: { ids: Array(5001).fill('x'), position: 0, autoplayIndex: null }
    }
    for (const state of [badArt, bigQueue]) {
      expect(await dispatch('player:publishState', ev(), [state])).toMatchObject({
        error: { code: 'INVALID_PAYLOAD' }
      })
    }
  })

  it('hazır olmayan player’a komut sessizce ok dönmez: PLAYER_NOT_READY (1.8c)', async () => {
    const { dispatch, hub } = setup()
    hub.command.mockImplementation(() => {
      throw new CoreError('PLAYER_NOT_READY', 'MusicKit hazır değil')
    })
    expect(await dispatch('player:command', ev(), [{ type: 'play' }])).toMatchObject({
      ok: false,
      error: { code: 'PLAYER_NOT_READY' }
    })
  })

  it('ana pencere yoksa komut PLAYER_UNAVAILABLE ile döner', async () => {
    const { dispatch, hub } = setup()
    hub.command.mockImplementation(() => {
      throw new CoreError('PLAYER_UNAVAILABLE', 'yok')
    })
    expect(await dispatch('player:command', ev(), [{ type: 'play' }])).toMatchObject({
      ok: false,
      error: { code: 'PLAYER_UNAVAILABLE' }
    })
  })
})

describe('IPC dispatcher: geçerli çağrılar', () => {
  it('developer token ve son kullanma zamanını döner', async () => {
    const { dispatch } = setup()
    expect(await dispatch('token:getDeveloperToken', ev(), [])).toEqual({
      ok: true,
      value: { token: FAKE_JWT, expiresAt: 1700000000 }
    })
  })

  it('oturumu yükler (eski biçim: ham token → kısıtlama bilinmiyor) / siler', async () => {
    const { dispatch } = setup()
    expect(await dispatch('auth:loadSession', ev(), [])).toEqual({
      ok: true,
      value: { token: SECRET, restricted: null }
    })
    expect(await dispatch('auth:clearUserToken', ev(), [])).toEqual({ ok: true, value: null })
  })

  it('silme worker’ın token’ını ve verisini de temizler (1.7a); yerel dosyalar da silinir (2.5)', async () => {
    const { dispatch, worker, localFiles } = setup()
    await dispatch('auth:authorize', ev(), [])
    expect(worker.setUserToken).toHaveBeenLastCalledWith(SECRET)
    await dispatch('auth:clearUserToken', ev(), [])
    expect(worker.setUserToken).toHaveBeenLastCalledWith(null)
    expect(worker.clearUserData).toHaveBeenCalled()
    expect(localFiles.clear).toHaveBeenCalledTimes(1)
  })

  it('çıkış (2.7): hub sıfırlanır; bir silme adımı başarısız olsa da diğerleri çalışır ve hata döner', async () => {
    const { dispatch, worker, localFiles, store, hub } = setup()
    worker.clearUserData.mockRejectedValueOnce(new CoreError('WORKER_UNAVAILABLE', 'silinemedi'))
    const result = await dispatch('auth:clearUserToken', ev(), [])
    expect(result).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } })
    expect(hub.reset).toHaveBeenCalled()
    expect(store.clear).toHaveBeenCalled()
    expect(localFiles.clear).toHaveBeenCalled()
  })

  it('renderer’ın token yazabildiği bir kanal yoktur (V3)', () => {
    const channels = Object.values(invokeContract).map((c) => c.channel)
    expect(channels).not.toContain('auth:saveUserToken')
  })

  it('Apple girişi (V3): oturum şifreli depoya ve worker’a yazılır, MusicKit için döner', async () => {
    const { dispatch, store, worker, authorizer } = setup()
    expect(await dispatch('auth:authorize', ev(), [])).toEqual({
      ok: true,
      value: { token: SECRET, restricted: false }
    })
    expect(authorizer.authorize).toHaveBeenCalledTimes(1)
    // Kısıtlama bayrağı token'la birlikte şifreli saklanır.
    expect(JSON.parse(store.save.mock.calls[0]![0])).toEqual({
      v: 1,
      token: SECRET,
      restricted: false
    })
    expect(worker.setUserToken).toHaveBeenLastCalledWith(SECRET)
  })

  it('Apple girişi yalnızca ana pencereden; iptal edilirse token yazılmaz', async () => {
    const { dispatch, store, authorizer } = setup()
    const aux = frame('app://renderer/mini.html', null, 2)
    expect(await dispatch('auth:authorize', ev(aux), [])).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' }
    })
    expect(authorizer.authorize).not.toHaveBeenCalled()

    authorizer.authorize.mockRejectedValueOnce(new CoreError('AUTHORIZATION_FAILED', 'kapatıldı'))
    expect(await dispatch('auth:authorize', ev(), [])).toMatchObject({
      ok: false,
      error: { code: 'AUTHORIZATION_FAILED' }
    })
    expect(store.save).not.toHaveBeenCalled()
  })

  it('worker bağlantısı çağıran çerçeveye verilir; worker yoksa kodlu hata döner', async () => {
    const { dispatch, worker } = setup()
    expect(await dispatch('worker:connect', ev(), [])).toEqual({ ok: true, value: null })
    expect(worker.connect).toHaveBeenCalledWith(trusted)

    worker.connect.mockRejectedValueOnce(new CoreError('WORKER_UNAVAILABLE', 'servis yok'))
    expect(await dispatch('worker:connect', ev(), [])).toEqual({
      ok: false,
      error: { code: 'WORKER_UNAVAILABLE', message: 'servis yok' }
    })
  })

  it('CDM durumunu döner', async () => {
    const { dispatch } = setup()
    expect(await dispatch('cdm:getStatus', ev(), [])).toEqual({
      ok: true,
      value: { state: 'pending' }
    })
  })
})

describe('IPC dispatcher: reddedilen çağrılar (1.3a kabul)', () => {
  it.each([
    ['sayı', [123]],
    ['string', ['abc']],
    ['negatif süre', [{ currentTime: -1, duration: 10 }]],
    ['aşırı büyük süre', [{ currentTime: 0, duration: 86_401 }]],
    ['fazla alan', [{ currentTime: 0, duration: 10, x: 1 }]],
    ['eksik argüman', []],
    ['fazla argüman', [{ currentTime: 0, duration: 10 }, 'fazla']]
  ])('geçersiz yük (%s): INVALID_PAYLOAD, handler çağrılmaz', async (_label, args) => {
    const { dispatch, hub } = setup()
    const res = await dispatch('player:publishTime', ev(), args)
    expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(hub.publishTime).not.toHaveBeenCalled()
  })

  it('argümansız kanala argüman gönderilirse reddeder', async () => {
    const { dispatch, tokenProvider } = setup()
    const res = await dispatch('token:getDeveloperToken', ev(), ['x'])
    expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } })
    expect(tokenProvider.getDeveloperToken).not.toHaveBeenCalled()
  })

  it('geçersiz yük loglanır ama değeri loglara yazılmaz', async () => {
    const { dispatch } = setup()
    await dispatch('player:command', ev(), [{ type: 'seek', seconds: SECRET }])
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('player:command')
    expect(logged).not.toContain(SECRET)
  })

  it.each(['auth:readFile', 'token:getDeveloperToken ', '__proto__', 'constructor', ''])(
    'bilinmeyen kanal (%j): UNKNOWN_CHANNEL',
    async (channel) => {
      const { dispatch } = setup()
      const res = await dispatch(channel, ev(), [])
      expect(res).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
    }
  )

  it.each<[string, SenderFrame | null]>([
    ['harici origin', frame('https://evil.com/')],
    ['Apple giriş penceresi', frame('https://authorize.music.apple.com/')],
    ['sahte app host', frame('app://evil/index.html')],
    ['iframe (alt çerçeve)', frame('app://renderer/index.html', {})],
    ['çerçeve yok', null]
  ])('güvenilmeyen gönderen (%s): FORBIDDEN, handler çağrılmaz', async (_label, frame) => {
    const { dispatch, store } = setup()
    const res = await dispatch('auth:loadSession', ev(frame), [])
    expect(res).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(store.load).not.toHaveBeenCalled()
  })
})

describe('IPC dispatcher: hata çevirimi', () => {
  it('TokenError / SecureStoreError katalog kodu, mesajı ve parametreleri renderer’a iletilir', async () => {
    const { dispatch } = setup({
      getDeveloperToken: async () => {
        throw new TokenError('TOKEN_ENV_MISSING', '.env eksik: APPLE_TEAM_ID', ['APPLE_TEAM_ID'])
      },
      loadSession: async () => {
        throw new SecureStoreError('STORE_ENCRYPTION_UNAVAILABLE', 'şifreleme yok')
      }
    })
    expect(await dispatch('token:getDeveloperToken', ev(), [])).toEqual({
      ok: false,
      error: {
        code: 'TOKEN_ENV_MISSING',
        message: '.env eksik: APPLE_TEAM_ID',
        params: { fields: 'APPLE_TEAM_ID' }
      }
    })
    expect(await dispatch('auth:loadSession', ev(), [])).toMatchObject({
      ok: false,
      error: { code: 'STORE_ENCRYPTION_UNAVAILABLE' }
    })
  })

  it('beklenmeyen hatanın ayrıntısı sızdırılmaz', async () => {
    const { dispatch } = setup({
      clearUserToken: async () => {
        throw new Error(`iç ayrıntı ${SECRET}`)
      }
    })
    const res = await dispatch('auth:clearUserToken', ev(), [])
    expect(res).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu.' }
    })
  })
})

describe('registerIpcHandlers', () => {
  it('yalnızca sözleşmedeki kanalları kaydeder', () => {
    const handle = vi.fn()
    registerIpcHandlers({ handle }, setup().handlers)
    const channels = handle.mock.calls.map(([channel]) => channel as string).sort()
    const expected = Object.values(invokeContract)
      .map((d) => d.channel)
      .sort()
    expect(channels).toEqual(expected)
  })
})

describe('IPC hız sınırı (2.4)', () => {
  it('kanal başına patlama sınırı aşılınca IPC_RATE_LIMITED; zamanla dolar; log seli yok', async () => {
    const clock = { t: 0 }
    const { handlers, hub } = setup()
    const dispatch = createIpcDispatcher(handlers, undefined, {
      rateLimit: { burst: 5, perSecond: 2 },
      now: () => clock.t
    })
    const call = () => dispatch('player:getState', ev(), [])
    const results = await Promise.all(Array.from({ length: 8 }, call))
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(results.at(-1)).toMatchObject({ ok: false, error: { code: 'IPC_RATE_LIMITED' } })
    expect(hub.snapshot).toHaveBeenCalledTimes(5)
    // Başka kanal etkilenmez.
    expect(await dispatch('cdm:getStatus', ev(), [])).toMatchObject({ ok: true })
    // 1 sn sonra 2 jeton.
    clock.t += 1_000
    expect((await call()).ok).toBe(true)
    expect((await call()).ok).toBe(true)
    expect((await call()).ok).toBe(false)
    const rateLogs = warn.mock.calls.flat().filter((l: unknown) => String(l).includes('IPC_004'))
    expect(rateLogs.length).toBeLessThanOrEqual(2)
  })

  it('ağır kanal (tanılama paketi) 5 sn’de en fazla bir kez (2.7 D6)', async () => {
    const clock = { t: 0 }
    const { handlers } = setup()
    const dispatch = createIpcDispatcher(handlers, undefined, { now: () => clock.t })
    const limited = async () => {
      const r = await dispatch(invokeContract.exportDiagnostics.channel, ev(), [])
      return !r.ok && r.error.code === 'IPC_RATE_LIMITED'
    }
    expect(await limited()).toBe(false)
    expect(await limited()).toBe(true)
    clock.t += 5_000
    expect(await limited()).toBe(false)
  })
})

describe('shell:openExternalLink (PLAN_v5 P4)', () => {
  it('ana pencere anahtarla açar; tarayıcıya yalnızca sabit https adres gider', async () => {
    const { dispatch, openExternal } = setup()
    expect(await dispatch('shell:openExternalLink', ev(), ['manageSubscriptions'])).toEqual({
      ok: true,
      value: null
    })
    expect(openExternal).toHaveBeenCalledWith(
      'https://account.apple.com/account/manage/section/subscriptions'
    )
  })

  it.each([
    ['URL gönderilemez', ['https://evil.example/']],
    ['bilinmeyen anahtar', ['manageEverything']],
    ['fazla argüman', ['manageSubscriptions', 'x']]
  ])('%s → INVALID_PAYLOAD, açılmaz', async (_l, args) => {
    const { dispatch, openExternal } = setup()
    expect(await dispatch('shell:openExternalLink', ev(), args)).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('yardımcı pencere açamaz (FORBIDDEN)', async () => {
    const { dispatch, openExternal } = setup()
    const aux = ev(frame('app://renderer/mini.html', null, 2))
    expect(await dispatch('shell:openExternalLink', aux, ['manageSubscriptions'])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('art arda çağrı hız sınırına takılır (sekme yağmuru yok)', async () => {
    const { dispatch, openExternal } = setup()
    for (let i = 0; i < 5; i++)
      await dispatch('shell:openExternalLink', ev(), ['manageSubscriptions'])
    expect(openExternal.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('window:control / window:getState (B1)', () => {
  it('kayıtlı pencere kendi penceresini yönetir ve durumunu okur', async () => {
    const { dispatch, windows } = setup()
    expect(await dispatch('window:control', ev(), ['toggleMaximize'])).toEqual({
      ok: true,
      value: null
    })
    expect(windows.controlWindow).toHaveBeenCalledWith(trusted, 'toggleMaximize')
    expect(await dispatch('window:getState', ev(), [])).toEqual({
      ok: true,
      value: { maximized: false, focused: true }
    })
  })

  it('kayıtlı olmayan çerçeve → FORBIDDEN; bilinmeyen eylem → INVALID_PAYLOAD', async () => {
    const { dispatch, windows } = setup()
    const stranger = ev(frame('app://renderer/index.html', null, 9))
    expect(await dispatch('window:control', stranger, ['close'])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    expect(await dispatch('window:getState', stranger, [])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    windows.controlWindow.mockClear()
    expect(await dispatch('window:control', ev(), ['setBounds'])).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(windows.controlWindow).not.toHaveBeenCalled()
  })
})

describe('window:openMini / window:closeMini (B12b)', () => {
  it('ana pencere MiniPlayer açar; MiniPlayer kendini kapatır', async () => {
    const { dispatch, windows } = setup()
    expect(await dispatch('window:openMini', ev(), [{ alwaysOnTop: true }])).toEqual({
      ok: true,
      value: null
    })
    expect(windows.openMiniPlayer).toHaveBeenCalledWith({ alwaysOnTop: true })
    const mini = ev(frame('app://renderer/mini.html', null, 2))
    expect(await dispatch('window:closeMini', mini, [])).toEqual({ ok: true, value: null })
  })

  it('başka pencere açamaz / kapatamaz; bozuk seçenek → INVALID_PAYLOAD', async () => {
    const { dispatch, windows } = setup()
    const mini = ev(frame('app://renderer/mini.html', null, 2))
    expect(await dispatch('window:openMini', mini, [{ alwaysOnTop: false }])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    expect(await dispatch('window:closeMini', ev(), [])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    expect(await dispatch('window:openMini', ev(), [{ alwaysOnTop: 'yes' }])).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(await dispatch('window:openMini', ev(), [{ alwaysOnTop: true, x: 1 }])).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(windows.openMiniPlayer).not.toHaveBeenCalled()
  })
})

describe('clipboard:copyAppleMusicLink', () => {
  it('ana pencere Apple Music bağlantısını panoya yazar', async () => {
    const { dispatch, writeClipboard } = setup()
    const url = 'https://music.apple.com/tr/album/1440806023'
    expect(await dispatch('clipboard:copyAppleMusicLink', ev(), [url])).toEqual({
      ok: true,
      value: null
    })
    expect(writeClipboard).toHaveBeenCalledWith(url)
  })

  it.each([
    ['başka site', 'https://evil.example/tr/album/1'],
    ['http', 'http://music.apple.com/tr/album/1'],
    ['düz metin', 'gizli metin'],
    ['yol enjeksiyonu', 'https://music.apple.com/tr/album/1/../../x']
  ])('%s → INVALID_PAYLOAD, panoya yazılmaz', async (_l, url) => {
    const { dispatch, writeClipboard } = setup()
    expect(await dispatch('clipboard:copyAppleMusicLink', ev(), [url])).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    expect(writeClipboard).not.toHaveBeenCalled()
  })

  it('yardımcı pencere yazamaz (FORBIDDEN)', async () => {
    const { dispatch, writeClipboard } = setup()
    const aux = ev(frame('app://renderer/mini.html', null, 2))
    expect(
      await dispatch('clipboard:copyAppleMusicLink', aux, ['https://music.apple.com/tr/song/1'])
    ).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(writeClipboard).not.toHaveBeenCalled()
  })
})

describe('net:warmupPlayback', () => {
  it('ana pencere ısıtma ister; argüman kabul edilmez; yardımcı pencere isteyemez', async () => {
    const { dispatch, warmupPlayback } = setup()
    expect(await dispatch('net:warmupPlayback', ev(), [])).toEqual({ ok: true, value: null })
    expect(warmupPlayback).toHaveBeenCalledTimes(1)
    expect(await dispatch('net:warmupPlayback', ev(), ['https://evil.example'])).toMatchObject({
      error: { code: 'INVALID_PAYLOAD' }
    })
    const aux = ev(frame('app://renderer/mini.html', null, 2))
    expect(await dispatch('net:warmupPlayback', aux, [])).toMatchObject({
      error: { code: 'FORBIDDEN' }
    })
    expect(warmupPlayback).toHaveBeenCalledTimes(1)
  })
})
