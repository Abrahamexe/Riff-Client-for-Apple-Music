import type { Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildCsp } from './csp'
import {
  applySessionPolicy,
  DEV_SERVER_URL,
  hardenWebContents,
  isAppleAuthUrl,
  isPermissionAllowed,
  isTrustedRendererUrl,
  redactUrl,
  restrictToRenderer
} from './security'

describe('isAppleAuthUrl', () => {
  it.each([
    'https://authorize.music.apple.com/woa?a=1',
    'https://idmsa.apple.com/appleauth/auth/signin',
    'https://activate.apple.com/x',
    'https://p16-buy.itunes.apple.com/WebObjects/x',
    'https://p123-buy.itunes.apple.com/',
    'https://AUTHORIZE.music.apple.com/'
  ])('izin verir (V3 gözlenen host): %s', (url) => expect(isAppleAuthUrl(url)).toBe(true))

  it.each([
    'http://authorize.music.apple.com/woa',
    'https://apple.com.evil.com/',
    'https://evilapple.com/',
    'https://evil.com/?u=https://apple.com/',
    'https://user:pw@authorize.music.apple.com/',
    'https://mzstatic.com/',
    // V3 daraltması: gözlenmeyen Apple host'ları artık yok
    'https://apple.com/',
    'https://appleid.apple.com/',
    'https://apps.mzstatic.com/content/x.js',
    'https://evil.apple.com/',
    'https://buy.itunes.apple.com/',
    'https://p16-buy.itunes.apple.com.evil.com/',
    'https://px-buy.itunes.apple.com/',
    'https://authorize.music.apple.com:8443/',
    'javascript:alert(1)',
    'file:///C:/Windows/win.ini',
    'app://renderer/index.html',
    'geçersiz',
    ''
  ])('engeller: %s', (url) => expect(isAppleAuthUrl(url)).toBe(false))
})

describe('isTrustedRendererUrl', () => {
  const dev = 'http://localhost:5173/'

  it('app://renderer içeriğine izin verir', () => {
    expect(isTrustedRendererUrl('app://renderer/index.html', undefined)).toBe(true)
  })

  it('dev server olmayan build’de ELECTRON_RENDERER_URL okunmaz', () => {
    // vitest __DEV_SERVER__ = false (production ile aynı)
    expect(DEV_SERVER_URL).toBeUndefined()
    expect(isTrustedRendererUrl('http://localhost:5173/x')).toBe(false)
  })

  it('dev sunucusu yalnızca dev URL verildiğinde güvenilirdir', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/x', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/x', undefined)).toBe(false)
  })

  it.each([
    'http://localhost:5173.evil.com/',
    'http://localhost:5174/',
    'app://evil/index.html',
    'https://authorize.music.apple.com/',
    'file:///C:/x.html',
    undefined,
    ''
  ])('reddeder: %s', (url) => expect(isTrustedRendererUrl(url, dev)).toBe(false))
})

describe('redactUrl', () => {
  it('sorgu ve fragment içermez', () => {
    const out = redactUrl('https://authorize.music.apple.com/woa?token=SECRET#frag=SECRET')
    expect(out).toBe('https://authorize.music.apple.com/woa')
  })

  it('özel şemada origin "null" yerine şema + host yazar', () => {
    expect(redactUrl('app://renderer/index.html?x=1')).toBe('app://renderer/index.html')
  })
})

describe('izin politikası (Güvenlik kuralı 7)', () => {
  it('yalnızca kendi içeriğimize mediaKeySystem (Widevine) izni verilir', () => {
    expect(isPermissionAllowed('mediaKeySystem', 'app://renderer/index.html')).toBe(true)
    expect(isPermissionAllowed('mediaKeySystem', 'app://renderer')).toBe(true)
    expect(isPermissionAllowed('mediaKeySystem', 'https://authorize.music.apple.com/')).toBe(false)
    expect(isPermissionAllowed('mediaKeySystem', undefined)).toBe(false)
  })

  it.each([
    'media',
    'geolocation',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
    'openExternal',
    'hid',
    'serial',
    'usb',
    'fullscreen',
    'pointerLock',
    'unknown'
  ])('reddeder: %s', (permission) =>
    expect(isPermissionAllowed(permission, 'app://renderer/index.html')).toBe(false)
  )

  it('applySessionPolicy işleyicileri kurar ve varsayılan olarak reddeder', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      on: vi.fn()
    }
    applySessionPolicy(session as unknown as Session)
    const request = session.setPermissionRequestHandler.mock.calls[0]![0]
    const contents = { getURL: () => 'app://renderer/index.html' }
    const cb = vi.fn()
    request(contents, 'media', cb, { requestingUrl: 'app://renderer/index.html' })
    request(contents, 'mediaKeySystem', cb, { requestingUrl: 'app://renderer/index.html' })
    expect(cb.mock.calls).toEqual([[false], [true]])
    const check = session.setPermissionCheckHandler.mock.calls[0]![0]
    expect(check(null, 'geolocation', 'app://renderer')).toBe(false)
    expect(session.setDevicePermissionHandler.mock.calls[0]![0]()).toBe(false)
    // P8 (F4): her indirme reddedilir; logda sorgu (token olabilir) yok.
    const [name, onDownload] = session.on.mock.calls[0]! as [
      string,
      (e: { preventDefault(): void }, item: { getURL(): string }) => void
    ]
    expect(name).toBe('will-download')
    const event = { preventDefault: vi.fn() }
    onDownload(event, { getURL: () => 'https://evil.example/x.exe?token=GIZLI' })
    expect(event.preventDefault).toHaveBeenCalled()
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('SEC_005')
    expect(logged).not.toContain('GIZLI')
    vi.restoreAllMocks()
  })
})

describe('webContents sertleştirme', () => {
  function fakeContents() {
    const handlers: Record<string, (event: { preventDefault(): void }, url?: string) => void> = {}
    let openHandler: ((details: { url: string }) => { action: string }) | null = null
    return {
      on: vi.fn((name: string, fn: (typeof handlers)[string]) => void (handlers[name] = fn)),
      setWindowOpenHandler: vi.fn((fn: typeof openHandler) => void (openHandler = fn)),
      open: (url: string) => openHandler?.({ url }),
      fire: (name: string, url?: string) => {
        const event = { preventDefault: vi.fn() }
        handlers[name]?.(event, url)
        return event.preventDefault.mock.calls.length > 0
      }
    }
  }

  it('ana içerik yalnızca kendi URL’sine gidebilir/yönlendirilebilir', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = fakeContents()
    restrictToRenderer(c as unknown as WebContents)
    expect(c.fire('will-navigate', 'app://renderer/index.html')).toBe(false)
    expect(c.fire('will-navigate', 'https://evil.com/')).toBe(true)
    expect(c.fire('will-redirect', 'https://authorize.music.apple.com/')).toBe(true)
    vi.restoreAllMocks()
  })

  it('webview eklenmesi engellenir', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = fakeContents()
    hardenWebContents(c as unknown as WebContents)
    expect(c.fire('will-attach-webview')).toBe(true)
    vi.restoreAllMocks()
  })

  it('engellemeler katalog koduyla (SEC_*) ve sorgu olmadan loglanır', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = fakeContents()
    hardenWebContents(c as unknown as WebContents)
    restrictToRenderer(c as unknown as WebContents)
    c.open('https://evil.com/x?token=SECRET')
    c.fire('will-navigate', 'https://evil.com/y?token=SECRET')
    c.fire('will-attach-webview')
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines[0]).toMatch(/^\[security\] SEC_002 POPUP_BLOCKED: .*https:\/\/evil\.com\/x$/)
    expect(lines[1]).toMatch(/SEC_001 NAVIGATION_BLOCKED/)
    expect(lines[2]).toMatch(/SEC_003 WEBVIEW_BLOCKED/)
    expect(lines.join('\n')).not.toContain('SECRET')
    vi.restoreAllMocks()
  })

  it('varsayılan olarak popup açılamaz (Apple allowlist yalnızca ana pencereye eklenir)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = fakeContents()
    hardenWebContents(c as unknown as WebContents)
    expect(c.open('https://authorize.music.apple.com/')).toEqual({ action: 'deny' })
    expect(c.open('https://evil.com/')).toEqual({ action: 'deny' })
    vi.restoreAllMocks()
  })
})

describe('CSP (Güvenlik kuralı 8)', () => {
  const directives = (csp: string) =>
    Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]))

  it('production: unsafe-inline/unsafe-eval ve localhost yok', () => {
    const csp = buildCsp(false)
    expect(csp).not.toMatch(/unsafe-(inline|eval)|localhost|\*\.apple\.com|https:(\s|;|$)/)
    const d = directives(csp)
    expect(d['default-src']).toEqual(["'self'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['script-src']).toEqual(["'self'", 'https://js-cdn.music.apple.com'])
    expect(d['style-src']).toEqual(["'self'"])
    // Worker yalnızca kendi kaynağı ve MusicKit'in blob'u (canlı radyo); uzak worker yok.
    expect(d['worker-src']).toEqual(["'self'", 'blob:'])
  })

  it('canlı radyo: akış, CDN ve anahtar sunucuları connect-src’de (2026-10-18 gözlemi)', () => {
    const connect = directives(buildCsp(false))['connect-src']
    expect(connect).toEqual(
      expect.arrayContaining([
        'https://itsliveradio.apple.com',
        'https://liveradio.music.apple.com',
        'https://liveradiobackup.music.apple.com',
        'https://linear.tv.apple.com'
      ])
    )
  })

  it('dev server: yalnızca connect-src’ye HMR websocket’i eklenir', () => {
    const prod = directives(buildCsp(false))
    const dev = directives(buildCsp(true))
    expect(dev['connect-src']).toEqual([...prod['connect-src']!, 'ws://localhost:*'])
    expect({ ...dev, 'connect-src': null }).toEqual({ ...prod, 'connect-src': null })
  })
})
