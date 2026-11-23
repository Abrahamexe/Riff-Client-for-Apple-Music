import { z } from 'zod/mini'
import { CoreError } from '@shared/errors'
import { UserTokenSchema, type AuthSession } from '@shared/ipc-contract'
import { blocked, isAppleAuthUrl, redactUrl } from './security'

// Apple Music girişi (V3 bulgusu). MusicKit'in `authorize()`'ı Apple giriş sayfasını window.open ile
// açar; sayfa token'ı opener'a postMessage ile, hedef origin'i `document.referrer`'dan alarak
// gönderir. Chromium `app://` şemasından referrer GÖNDERMEZ: referrer boş kalınca Apple sayfası
// opener kanalını hiç kurmaz, token kaybolur, pencere kendini kapatır ve MusicKit "Unauthorized" ile
// reddeder (gözlem: docs/MANUAL_TESTS.md V3).
//
// Çözüm: Apple sayfasının opener'sız durumda kullandığı yedek yol. Sayfa, `document.referrer`
// (veya aynı origin'deki `referrer` sorgu parametresi) adresine `#<base64 JSON>` ile yönlendirir.
// Giriş penceresi opener'sız, kendi penceremiz olarak açılır; referrer olarak hiçbir zaman
// çözülmeyen (.invalid, RFC 2606) bir geri dönüş adresi verilir; bu adrese yapılan navigasyon
// main'de yakalanır ve iptal edilir: istek ağa çıkmaz. Apple sayfasına kod enjekte edilmez.

const APPLE_AUTHORIZE_URL = 'https://authorize.music.apple.com/woa'
/** Giriş sonucunun döndüğü adres; `.invalid` olduğu için hiçbir zaman çözülmez. */
export const AUTH_CALLBACK_URL = 'https://auth.am-client.invalid/callback'
const CALLBACK_ORIGIN = new URL(AUTH_CALLBACK_URL).origin

/**
 * MusicKit JS v3'ün kurduğu adresin aynısı (`_authorizeAction`): varsayılan deeplink parametreleri
 * (`app=music`, `p=subscribe`), `a` = base64(JSON third-party bilgisi), `referrer`.
 */
export function buildAuthorizeUrl(developerToken: string, appName: string): string {
  const thirdParty = JSON.stringify({ thirdPartyName: appName, thirdPartyToken: developerToken })
  const url = new URL(APPLE_AUTHORIZE_URL)
  url.searchParams.set('app', 'music')
  url.searchParams.set('p', 'subscribe')
  url.searchParams.set('a', Buffer.from(thirdParty, 'utf8').toString('base64'))
  url.searchParams.set('referrer', AUTH_CALLBACK_URL)
  return url.toString()
}

/** Apple'ın fragment'ta döndürdüğü veri (`btoa(JSON.stringify({cid, itre, musicUserToken}))`). */
const CallbackDataSchema = z.object({
  musicUserToken: UserTokenSchema,
  cid: z.optional(z.unknown()),
  itre: z.optional(z.unknown())
})

export type AuthCallback = ({ kind: 'token' } & AuthSession) | { kind: 'declined' }

/** Apple `itre` (iTunes restrictions enabled): "1"/"0" veya boolean; yoksa bilinmiyor. */
function restrictionFlag(itre: unknown): boolean | null {
  if (itre === '1' || itre === 1 || itre === true) return true
  if (itre === '0' || itre === 0 || itre === false) return false
  return null
}

/**
 * Navigasyon geri dönüş adresine mi? Değilse `null`. Fragment'ta geçerli token yoksa `declined`
 * (kullanıcı reddetti veya veri bozuk). Dönen değer loglanmaz.
 */
export function parseAuthCallback(rawUrl: string): AuthCallback | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.origin !== CALLBACK_ORIGIN) return null
  const fragment = url.hash.slice(1)
  if (fragment === '') return { kind: 'declined' }
  try {
    const decoded = Buffer.from(decodeURIComponent(fragment), 'base64').toString('utf8')
    const parsed = CallbackDataSchema.safeParse(JSON.parse(decoded))
    return parsed.success
      ? {
          kind: 'token',
          token: parsed.data.musicUserToken,
          restricted: restrictionFlag(parsed.data.itre)
        }
      : { kind: 'declined' }
  } catch {
    return { kind: 'declined' }
  }
}

/** Giriş penceresinin kullandığımız yüzeyi (Electron BrowserWindow; testte sahte nesne). */
export interface AuthWindow {
  readonly webContents: {
    on(
      event: 'will-navigate' | 'will-redirect',
      listener: (event: { preventDefault(): void }, url: string) => void
    ): unknown
  }
  loadURL(url: string, options: { httpReferrer: string }): Promise<void>
  once(event: 'closed', listener: () => void): unknown
  close(): void
  focus(): void
  isDestroyed(): boolean
}

export interface AppleAuthorizerDeps {
  getDeveloperToken(): Promise<string>
  /** Opener'sız, sandbox'lı, preload'suz giriş penceresi (auth-window.ts). */
  createWindow(): AuthWindow
  /** Apple onay ekranında görünen uygulama adı. */
  appName: string
  /** Gerçek girişte kullanılan host'lar bir kez loglanır (allowlist daraltma, PLAN V3). */
  onHost?: (host: string) => void
}

/** Apple giriş akışı: aynı anda tek pencere; ikinci çağrı açık pencereyi öne getirir. */
export class AppleAuthorizer {
  private pending: Promise<AuthSession> | null = null
  private window: AuthWindow | null = null

  constructor(private readonly deps: AppleAuthorizerDeps) {}

  authorize(): Promise<AuthSession> {
    if (this.pending) {
      if (this.window && !this.window.isDestroyed()) this.window.focus()
      return this.pending
    }
    const run = this.start()
    this.pending = run
    const clear = (): void => {
      if (this.pending !== run) return
      this.pending = null
      this.window = null
    }
    run.then(clear, clear)
    return run
  }

  private async start(): Promise<AuthSession> {
    let developerToken: string
    try {
      developerToken = await this.deps.getDeveloperToken()
    } catch (cause) {
      throw new CoreError('DEVELOPER_TOKEN_UNAVAILABLE', 'Giriş için developer token alınamadı.', {
        cause
      })
    }
    const win = this.deps.createWindow()
    this.window = win
    const result = new Promise<AuthSession>((resolve, reject) => {
      let settled = false
      const settle = (outcome: AuthCallback | 'closed'): void => {
        if (settled) return
        settled = true
        if (outcome !== 'closed' && !win.isDestroyed()) win.close()
        if (outcome !== 'closed' && outcome.kind === 'token')
          resolve({ token: outcome.token, restricted: outcome.restricted })
        else
          reject(
            new CoreError(
              'AUTHORIZATION_FAILED',
              outcome === 'closed'
                ? 'Apple giriş penceresi kapatıldı.'
                : 'Apple girişi reddedildi veya geçerli token dönmedi.'
            )
          )
      }

      const guard = (event: { preventDefault(): void }, url: string): void => {
        const callback = parseAuthCallback(url)
        if (callback) {
          // Geri dönüş adresine istek ATILMAZ; URL (fragment'ta token) loglanmaz.
          event.preventDefault()
          settle(callback)
          return
        }
        if (isAppleAuthUrl(url)) {
          this.noteHost(url)
          return
        }
        blocked('NAVIGATION_BLOCKED', `engellendi: ${redactUrl(url)}`, 'auth-window')
        event.preventDefault()
      }
      win.webContents.on('will-navigate', guard)
      win.webContents.on('will-redirect', guard)
      win.once('closed', () => settle('closed'))
    })

    const url = buildAuthorizeUrl(developerToken, this.deps.appName)
    this.noteHost(url)
    // Yükleme hataları pencere tarafında maskeli loglanır ve bir kez yeniden denenir
    // (watchLoadFailures). Red nedeni BURADA loglanmaz: Electron'un hata mesajı tam URL'yi (a=
    // parametresinde developer token) içerir.
    win.loadURL(url, { httpReferrer: AUTH_CALLBACK_URL }).catch(() => {})
    return result
  }

  private noteHost(url: string): void {
    try {
      this.deps.onHost?.(new URL(url).hostname)
    } catch {
      /* geçersiz URL: host yok */
    }
  }
}
