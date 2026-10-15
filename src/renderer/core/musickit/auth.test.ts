import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '../errors'
import {
  restoreSession,
  signIn,
  signOut,
  syncStorefront,
  type StoredSession,
  type UserTokenStore
} from './auth'
import type { MusicKitInstance } from './types'

function setup(opts: { authorized?: boolean; authorize?: () => Promise<string> } = {}) {
  let token: string | undefined
  const authorize = vi.fn(opts.authorize ?? (async () => 'yeni-token'))
  const unauthorize = vi.fn(async () => {
    token = undefined
  })
  let restricted: boolean | undefined
  const stop = vi.fn(async () => {})
  const music = {
    get restrictedEnabled() {
      return restricted
    },
    set restrictedEnabled(v: boolean | undefined) {
      restricted = v
    },
    get isAuthorized() {
      return opts.authorized === true || (token !== undefined && token !== '')
    },
    get musicUserToken() {
      return token
    },
    set musicUserToken(v: string | undefined) {
      token = v
    },
    authorize,
    unauthorize,
    stop
  } as unknown as MusicKitInstance
  vi.stubGlobal('window', { MusicKit: { getInstance: () => music } })

  let stored: StoredSession | null = null
  const store: UserTokenStore = {
    load: vi.fn(async () => stored),
    clear: vi.fn(async () => {
      stored = null
    })
  }
  return {
    music,
    store,
    authorize,
    unauthorize,
    stop,
    setStored: (v: StoredSession | null) => (stored = v)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('restoreSession', () => {
  it('kayıtlı token varsa MusicKit’e yükler ve giriş penceresi açmaz', async () => {
    const { music, store, authorize, setStored } = setup()
    setStored({ token: 'kayitli-token', restricted: false })
    const state = await restoreSession(store)
    expect(state).toEqual({ authorized: true, restored: true })
    expect(music.musicUserToken).toBe('kayitli-token')
    expect(music.restrictedEnabled).toBe(false)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('kayıtlı token yoksa yetkisiz döner', async () => {
    const { store } = setup()
    expect(await restoreSession(store)).toEqual({ authorized: false, restored: false })
  })

  it('syncStorefront: false → mağaza eşitlemesi yapılmaz (R2: çağıran arka planda yapar)', async () => {
    const { music, store, setStored } = setup()
    const me = vi.fn()
    Object.assign(music, { me })
    setStored({ token: 'kayitli-token', restricted: false })
    expect(await restoreSession(store, { syncStorefront: false })).toEqual({
      authorized: true,
      restored: true
    })
    expect(me).not.toHaveBeenCalled()
  })

  it('MusicKit zaten yetkiliyse depoya bakmaz', async () => {
    const { store } = setup({ authorized: true })
    expect(await restoreSession(store)).toEqual({ authorized: true, restored: false })
    expect(store.load).not.toHaveBeenCalled()
  })
})

describe('syncStorefront (2.1: setQueue hesap mağazasına gitmeli)', () => {
  /** MusicKit gibi: storefrontId, me() ile öğrenilen kullanıcı mağazasından türetilir. */
  function withStorekit(music: MusicKitInstance, impl: () => Promise<string>) {
    let country = 'us'
    const request = vi.fn(async () => {
      country = await impl()
      return { subscription: { storefront: country } }
    })
    Object.defineProperty(music, 'storefrontId', { get: () => country, configurable: true })
    Object.assign(music, { me: request })
    return { request, reset: () => (country = 'us') }
  }

  it('hesap mağazası MusicKit’in kendi yoluyla öğrenilir; giriş ve geri yüklemede çağrılır', async () => {
    const { music } = setup()
    const sk = withStorekit(music, async () => 'tr')
    expect(await syncStorefront()).toBe(true)
    expect(music.storefrontId).toBe('tr')

    sk.reset()
    await restoreSession({
      load: async () => ({ token: 'kayitli', restricted: false }),
      clear: vi.fn()
    })
    expect(music.storefrontId).toBe('tr')

    sk.reset()
    await signIn(async () => ({ token: 'yeni', restricted: null }))
    expect(music.storefrontId).toBe('tr')
    expect(sk.request).toHaveBeenCalledTimes(3)
  })

  it('ağ hatası veya me() yoksa false döner, mağaza değişmez (çalma engellenmez)', async () => {
    const { music } = setup()
    withStorekit(music, async () => Promise.reject(new Error('ağ yok')))
    expect(await syncStorefront()).toBe(false)
    expect(music.storefrontId).toBe('us')
    Object.assign(music, { me: undefined })
    expect(await syncStorefront()).toBe(false)
  })
})

describe('signIn / signOut', () => {
  it('main’in döndürdüğü token MusicKit’e verilir; music.authorize() kullanılmaz (V3)', async () => {
    const { music, authorize } = setup()
    await signIn(async () => ({ token: 'main-token', restricted: false }))
    expect(music.musicUserToken).toBe('main-token')
    // V4: kısıtlama açıkça verilir; MusicKit'in mağazaya göre tahmini (tr → kısıtlı) devre dışı.
    expect(music.restrictedEnabled).toBe(false)
    expect(music.isAuthorized).toBe(true)
    expect(authorize).not.toHaveBeenCalled()
  })

  it('giriş iptal edilirse AUTHORIZATION_FAILED verir ve MusicKit’e token verilmez', async () => {
    const { music } = setup()
    const err = await signIn(async () => {
      throw new Error('kapatıldı')
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CoreError)
    expect((err as CoreError).code).toBe('AUTHORIZATION_FAILED')
    expect(music.musicUserToken).toBeUndefined()
  })

  it('katalog kodlu başka hatalar (ör. depo şifreleme yok) olduğu gibi iletilir', async () => {
    setup()
    const err = await signIn(async () => {
      throw new CoreError('STORE_ENCRYPTION_UNAVAILABLE', 'şifreleme yok')
    }).catch((e: unknown) => e)
    expect((err as CoreError).code).toBe('STORE_ENCRYPTION_UNAVAILABLE')
  })

  it('çıkışta MusicKit oturumu kapanır ve kayıtlı token silinir', async () => {
    const { store, unauthorize, setStored } = setup()
    setStored({ token: 'kayitli-token', restricted: null })
    await signOut(store)
    expect(unauthorize).toHaveBeenCalled()
    expect(store.clear).toHaveBeenCalled()
  })

  it('çalma silmeden önce durdurulur (2.7 Y2); durdurma hatası çıkışı engellemez', async () => {
    const { store, stop } = setup()
    const order: string[] = []
    stop.mockImplementationOnce(async () => {
      order.push('stop')
      throw new Error('çalmıyor')
    })
    vi.mocked(store.clear).mockImplementationOnce(async () => {
      order.push('clear')
    })
    await signOut(store)
    expect(order).toEqual(['stop', 'clear'])
  })

  it('MusicKit çıkışı hata verse bile kayıtlı token silinir', async () => {
    const { store, unauthorize } = setup()
    unauthorize.mockRejectedValueOnce(new Error('ağ yok'))
    await expect(signOut(store)).rejects.toThrow('ağ yok')
    expect(store.clear).toHaveBeenCalled()
  })

  it('yerel veri, Apple oturum kapatma isteği bitmeden silinir (V3: istek ~15 sn sürebilir)', async () => {
    const { store, unauthorize } = setup()
    let finishLogout: () => void = () => {}
    unauthorize.mockImplementationOnce(() => new Promise<void>((r) => (finishLogout = r)))
    const done = signOut(store)
    await vi.waitFor(() => expect(unauthorize).toHaveBeenCalled())
    expect(store.clear).toHaveBeenCalled()
    finishLogout()
    await done
  })

  it('yerel silme başarısız olsa bile MusicKit oturumu kapatılır', async () => {
    const { store, unauthorize } = setup()
    vi.mocked(store.clear).mockRejectedValueOnce(new Error('disk'))
    await expect(signOut(store)).rejects.toThrow('disk')
    expect(unauthorize).toHaveBeenCalled()
  })
})

describe('getMusicKit (yapılandırılmamış)', () => {
  it('getInstance() undefined dönerse MUSICKIT_NOT_CONFIGURED fırlatır', async () => {
    vi.stubGlobal('window', { MusicKit: { getInstance: () => undefined } })
    const { getMusicKit } = await import('./loader')
    expect(() => getMusicKit()).toThrowError(
      expect.objectContaining({ code: 'MUSICKIT_NOT_CONFIGURED' })
    )
  })

  it('MusicKit hiç yüklenmemişse de aynı hata', async () => {
    vi.stubGlobal('window', {})
    const { getMusicKit } = await import('./loader')
    expect(() => getMusicKit()).toThrowError(
      expect.objectContaining({ code: 'MUSICKIT_NOT_CONFIGURED' })
    )
  })
})
