import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AppleAuthorizer,
  AUTH_CALLBACK_URL,
  buildAuthorizeUrl,
  parseAuthCallback,
  type AuthWindow
} from './apple-authorizer'

const DEV_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJURUFNIn0.DEV-SECRET-SIG'
const USER_TOKEN = 'AmUserTokenSECRET0123456789+/='

/** Apple'ın geri dönüş adresine eklediği fragment: btoa(JSON.stringify({cid, itre, musicUserToken})). */
const callbackUrl = (data: unknown): string =>
  `${AUTH_CALLBACK_URL}#${Buffer.from(JSON.stringify(data)).toString('base64')}`

describe('buildAuthorizeUrl', () => {
  it('MusicKit v3 ile aynı parametreler; uygulama adı ve geri dönüş adresi', () => {
    const url = new URL(buildAuthorizeUrl(DEV_TOKEN, 'Riff Client'))
    expect(url.origin + url.pathname).toBe('https://authorize.music.apple.com/woa')
    expect(url.searchParams.get('app')).toBe('music')
    expect(url.searchParams.get('p')).toBe('subscribe')
    expect(url.searchParams.get('referrer')).toBe(AUTH_CALLBACK_URL)
    const info = JSON.parse(Buffer.from(url.searchParams.get('a')!, 'base64').toString()) as object
    expect(info).toEqual({ thirdPartyName: 'Riff Client', thirdPartyToken: DEV_TOKEN })
  })

  it('geri dönüş adresi hiçbir zaman çözülmeyen .invalid alan adıdır (RFC 2606)', () => {
    expect(new URL(AUTH_CALLBACK_URL).hostname.endsWith('.invalid')).toBe(true)
    expect(new URL(AUTH_CALLBACK_URL).protocol).toBe('https:')
  })
})

describe('parseAuthCallback', () => {
  it('geçerli fragment → token', () => {
    expect(
      parseAuthCallback(callbackUrl({ cid: 'c', itre: '0', musicUserToken: USER_TOKEN }))
    ).toEqual({ kind: 'token', token: USER_TOKEN, restricted: false })
  })

  it('yüzde kodlu fragment de çözülür', () => {
    const raw = callbackUrl({ musicUserToken: USER_TOKEN })
    const [base, frag] = raw.split('#')
    expect(parseAuthCallback(`${base}#${encodeURIComponent(frag!)}`)).toEqual({
      kind: 'token',
      token: USER_TOKEN,
      restricted: null
    })
  })

  it.each([
    [{ itre: '1' }, true],
    [{ itre: '0' }, false],
    [{ itre: true }, true],
    [{}, null],
    [{ itre: 'x' }, null]
  ])('içerik kısıtlaması (itre) %j → %s', (extra, restricted) => {
    expect(parseAuthCallback(callbackUrl({ ...extra, musicUserToken: USER_TOKEN }))).toEqual({
      kind: 'token',
      token: USER_TOKEN,
      restricted
    })
  })

  it.each([
    ['fragment yok (reddetti)', AUTH_CALLBACK_URL],
    ['bozuk base64/JSON', `${AUTH_CALLBACK_URL}#%%%`],
    ['token yok', callbackUrl({ cid: 'c' })],
    ['token boşluklu', callbackUrl({ musicUserToken: 'a b' })],
    ['token sayı', callbackUrl({ musicUserToken: 42 })]
  ])('%s → declined', (_l, url) => expect(parseAuthCallback(url)).toEqual({ kind: 'declined' }))

  it.each([
    'https://authorize.music.apple.com/woa#eyJ9',
    'https://auth.am-client.invalid.evil.com/callback#x',
    'http://auth.am-client.invalid/callback#x',
    'nonsense'
  ])('geri dönüş adresi değil: %s → null', (url) => expect(parseAuthCallback(url)).toBeNull())
})

type FakeWindow = AuthWindow & {
  contents: EventEmitter
  events: EventEmitter
  destroyed: boolean
  loadURL: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  navigate(url: string, kind?: 'will-navigate' | 'will-redirect'): boolean
}

function fakeWindow(): FakeWindow {
  const contents = new EventEmitter()
  const events = new EventEmitter()
  const win = {
    contents,
    events,
    destroyed: false,
    webContents: contents,
    loadURL: vi.fn(async () => {}),
    once: (event: string, l: () => void) => events.once(event, l),
    close: vi.fn(() => {
      win.destroyed = true
      events.emit('closed')
    }),
    focus: vi.fn(),
    isDestroyed: () => win.destroyed,
    /** Navigasyonu tetikler; engellendiyse true. */
    navigate(url: string, kind: 'will-navigate' | 'will-redirect' = 'will-navigate') {
      let prevented = false
      contents.emit(kind, { preventDefault: () => (prevented = true) }, url)
      return prevented
    }
  }
  return win
}

function setup() {
  const windows: FakeWindow[] = []
  const hosts: string[] = []
  const getDeveloperToken = vi.fn(async () => DEV_TOKEN)
  const authorizer = new AppleAuthorizer({
    appName: 'Riff Client',
    getDeveloperToken,
    onHost: (h) => hosts.push(h),
    createWindow: () => {
      const w = fakeWindow()
      windows.push(w)
      return w
    }
  })
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  return { authorizer, windows, hosts, getDeveloperToken, flush }
}

describe('AppleAuthorizer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('Apple adresini referrer = geri dönüş adresiyle yükler; dönüşte token verir, pencereyi kapatır', async () => {
    const { authorizer, windows, hosts, flush } = setup()
    const result = authorizer.authorize()
    await flush()
    const win = windows[0]!
    expect(win.loadURL).toHaveBeenCalledWith(expect.stringContaining('authorize.music.apple.com'), {
      httpReferrer: AUTH_CALLBACK_URL
    })

    expect(win.navigate('https://idmsa.apple.com/appleauth/auth/signin')).toBe(false)
    expect(win.navigate('https://p16-buy.itunes.apple.com/x', 'will-redirect')).toBe(false)
    // Geri dönüş: navigasyon iptal edilir (ağa çıkmaz), token döner.
    expect(win.navigate(callbackUrl({ musicUserToken: USER_TOKEN }))).toBe(true)
    await expect(result).resolves.toEqual({ token: USER_TOKEN, restricted: null })
    expect(win.close).toHaveBeenCalled()
    expect(hosts).toEqual([
      'authorize.music.apple.com',
      'idmsa.apple.com',
      'p16-buy.itunes.apple.com'
    ])
  })

  it('pencere kapatılırsa AUTHORIZATION_FAILED; sonraki çağrı yeni pencere açar', async () => {
    const { authorizer, windows, flush } = setup()
    const first = authorizer.authorize()
    await flush()
    windows[0]!.close()
    await expect(first).rejects.toMatchObject({ code: 'AUTHORIZATION_FAILED' })

    const second = authorizer.authorize()
    await flush()
    expect(windows).toHaveLength(2)
    windows[1]!.navigate(callbackUrl({ musicUserToken: USER_TOKEN }))
    await expect(second).resolves.toEqual({ token: USER_TOKEN, restricted: null })
  })

  it('reddedilirse (fragment yok) AUTHORIZATION_FAILED ve pencere kapanır', async () => {
    const { authorizer, windows, flush } = setup()
    const result = authorizer.authorize()
    await flush()
    expect(windows[0]!.navigate(AUTH_CALLBACK_URL)).toBe(true)
    await expect(result).rejects.toMatchObject({ code: 'AUTHORIZATION_FAILED' })
    expect(windows[0]!.close).toHaveBeenCalled()
  })

  it('aynı anda tek pencere: ikinci çağrı aynı sonucu bekler ve pencereyi öne getirir', async () => {
    const { authorizer, windows, getDeveloperToken, flush } = setup()
    const a = authorizer.authorize()
    const b = authorizer.authorize()
    await flush()
    expect(getDeveloperToken).toHaveBeenCalledTimes(1)
    expect(windows).toHaveLength(1)
    authorizer.authorize().catch(() => {})
    expect(windows[0]!.focus).toHaveBeenCalled()
    windows[0]!.navigate(callbackUrl({ musicUserToken: USER_TOKEN }))
    const session = { token: USER_TOKEN, restricted: null }
    await expect(Promise.all([a, b])).resolves.toEqual([session, session])
  })

  it('Apple dışı navigasyon engellenir ve maskeli loglanır', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { authorizer, windows, flush } = setup()
    void authorizer.authorize().catch(() => {})
    await flush()
    expect(windows[0]!.navigate('https://evil.example/phish?token=SECRET')).toBe(true)
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('https://evil.example/phish')
    expect(logged).not.toContain('SECRET')
  })

  it('developer token alınamazsa pencere açılmaz', async () => {
    const { authorizer, windows, getDeveloperToken } = setup()
    getDeveloperToken.mockRejectedValueOnce(new Error('env yok'))
    await expect(authorizer.authorize()).rejects.toMatchObject({
      code: 'DEVELOPER_TOKEN_UNAVAILABLE'
    })
    expect(windows).toHaveLength(0)
  })

  it('token hiçbir log çıktısında görünmez', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    )
    const { authorizer, windows, flush } = setup()
    const result = authorizer.authorize()
    await flush()
    windows[0]!.navigate('https://idmsa.apple.com/x')
    windows[0]!.navigate(callbackUrl({ musicUserToken: USER_TOKEN }))
    await result
    const all = spies.flatMap((s) => s.mock.calls.flat()).join(' ')
    expect(all).not.toContain(USER_TOKEN)
    expect(all).not.toContain(DEV_TOKEN)
  })
})
