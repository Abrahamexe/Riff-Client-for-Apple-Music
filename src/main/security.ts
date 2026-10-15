import type { Session, WebContents } from 'electron'
import { CoreError, logError, type ErrorCode } from '@shared/errors'
import { APP_HOST, APP_SCHEME } from './appOrigin'

// Navigasyon, izin ve popup politikaları (Güvenlik kuralı 2, 4, 7). Electron'a yalnızca tip olarak
// bağlıdır; birim testlerinde doğrudan import edilebilir.

// Renderer'ın kendi içeriği: dev'de Vite dev server, aksi halde app://renderer/.
// Dev server URL'si YALNIZCA `electron-vite dev` build'inde okunur: production'da ortam değişkeniyle
// pencereyi harici bir adrese yönlendirmek (ve ona preload API'si açtırmak) mümkün değildir.
export const DEV_SERVER_URL: string | undefined = __DEV_SERVER__
  ? process.env['ELECTRON_RENDERER_URL']
  : undefined

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Ana pencerenin gidebileceği ve IPC çağırabileceği güvenilir renderer URL'si mi?
 * Önek değil origin karşılaştırılır (`http://localhost:5173.evil.com` geçemez).
 */
export function isTrustedRendererUrl(url: string | undefined, devUrl = DEV_SERVER_URL): boolean {
  const parsed = url ? parse(url) : null
  if (!parsed) return false
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) return true
  const dev = devUrl ? parse(devUrl) : null
  return dev !== null && parsed.origin === dev.origin
}

// Apple giriş penceresinin gidebileceği host'lar (Güvenlik kuralı 7). PLAN V3 (2026-10-12): geçici
// `*.apple.com` kuralı altında gerçek girişlerde gözlenen host'lara daraltıldı (docs/MANUAL_TESTS.md):
//   authorize.music.apple.com → activate.apple.com → idmsa.apple.com → pNN-buy.itunes.apple.com
// `pNN-buy` Apple'ın sunucu havuzudur (gözlem: p16, p26, p39, p57); yalnızca bu biçim kabul edilir.
// Listede olmayan bir host gerekirse engelleme logundan (SEC_001/SEC_002) gözlenip buraya eklenir.
const APPLE_AUTH_HOSTS: ReadonlySet<string> = new Set([
  'authorize.music.apple.com',
  'activate.apple.com',
  'idmsa.apple.com'
])
const APPLE_BUY_POOL_HOST = /^p\d{1,3}-buy\.itunes\.apple\.com$/

export function isAppleAuthUrl(url: string): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '') return false
  const host = parsed.hostname.toLowerCase()
  return APPLE_AUTH_HOSTS.has(host) || APPLE_BUY_POOL_HOST.test(host)
}

/** Politika engellemesini katalog koduyla loglar (URL'ler önceden redactUrl'den geçer). */
export function blocked(code: ErrorCode, message: string, scope = 'security'): void {
  logError(scope, new CoreError(code, message))
}

/** Loglarda sorgu/fragment (token içerebilir) yer almasın diye yalnızca origin + path. */
export function redactUrl(url: string): string {
  const parsed = parse(url)
  // `origin` değil: özel şemalarda (app://) Node/Chromium origin'i "null" döner.
  return parsed ? `${parsed.protocol}//${parsed.host}${parsed.pathname}` : '(geçersiz URL)'
}

// --- İzinler (Güvenlik kuralı 7) ----------------------------------------------------------------
// Varsayılan RED. Yalnızca Widevine/EME'nin istediği `mediaKeySystem` ve yalnızca kendi içeriğimize.
// Kamera, mikrofon, konum, bildirim, pano, HID/USB/seri vb. her şey reddedilir.
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['mediaKeySystem'])

export function isPermissionAllowed(
  permission: string,
  requestingUrl: string | undefined
): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isTrustedRendererUrl(requestingUrl)
}

/** Oturumun izin işleyicilerini kurar; izin verilmeyen istekler loglanır (değerleri değil, adları). */
export function applySessionPolicy(session: Session): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = isPermissionAllowed(permission, details.requestingUrl ?? contents.getURL())
    if (!allowed) {
      blocked(
        'PERMISSION_DENIED',
        `izin reddedildi: ${permission} ← ${redactUrl(details.requestingUrl)}`
      )
    }
    callback(allowed)
  })
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin)
  )
  session.setDevicePermissionHandler(() => false)
  // P8 (F4): uygulama hiçbir şeyi tarayıcı indirmesiyle almaz (tanılama paketini main doğrudan yazar).
  // Sayfadaki üçüncü taraf betik (MusicKit) bir indirme tetiklerse kaydetme penceresi açılmaz.
  session.on('will-download', (event, item) => {
    blocked('DOWNLOAD_BLOCKED', `indirme engellendi: ${redactUrl(item.getURL())}`)
    event.preventDefault()
  })
}

/**
 * Her webContents'e (ana pencere, Apple giriş penceresi ve ileride oluşabilecek her şey):
 * webview eklenemez; ana içerik güvenilir URL dışına gidemez / yönlendirilemez.
 */
export function hardenWebContents(contents: WebContents): void {
  // Varsayılan: popup YOK. Ana pencere bunu Apple giriş allowlist'iyle değiştirir (auth-window.ts);
  // yardımcı pencereler (ör. mini oynatıcı) hiç popup açamaz.
  contents.setWindowOpenHandler(({ url }) => {
    blocked('POPUP_BLOCKED', `popup engellendi: ${redactUrl(url)}`)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (event) => {
    blocked('WEBVIEW_BLOCKED', 'webview engellendi')
    event.preventDefault()
  })
}

/** Ana pencere yalnızca kendi içeriğine gidebilir (navigasyon ve sunucu yönlendirmesi). */
export function restrictToRenderer(contents: WebContents): void {
  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (isTrustedRendererUrl(url)) return
    blocked('NAVIGATION_BLOCKED', `navigasyon engellendi: ${redactUrl(url)}`)
    event.preventDefault()
  }
  contents.on('will-navigate', (event, url) => guard(event, url))
  contents.on('will-redirect', (event, url) => guard(event, url))
}
