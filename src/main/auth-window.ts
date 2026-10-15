import type { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron'
import { CoreError, logError } from '@shared/errors'
import { blocked, isAppleAuthUrl, redactUrl } from './security'

// Apple giriş penceresi (V3). Pencere ana pencerenin popup'ı DEĞİLDİR: main tarafından opener'sız
// açılır, sonuç geri dönüş adresine yapılan navigasyondan alınır (apple-authorizer.ts). Ana pencere
// hiç popup açamaz (security.ts hardenWebContents). Giriş penceresinin içinden Apple'ın açtığı
// popup'lara (ör. "parolamı unuttum") yalnızca Apple domain'lerinde izin verilir (Güvenlik kuralı 7).
//
// PLAN V3 allowlist daraltma: gerçek girişte kullanılan host'lar (yalnızca host adı; yol/sorgu
// token içerebileceği için loglanmaz) bir kez loglanır.
const seenAuthHosts = new Set<string>()

export function noteAuthHost(host: string): void {
  if (seenAuthHosts.has(host)) return
  seenAuthHosts.add(host)
  console.info(`[auth-window] giriş host'u kullanıldı: ${host}`)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function restrictNavigation(contents: WebContents): void {
  const guard = (event: { preventDefault(): void }, url: string): void => {
    if (isAppleAuthUrl(url)) return noteAuthHost(hostOf(url))
    blocked('NAVIGATION_BLOCKED', `engellendi: ${redactUrl(url)}`, 'auth-window')
    event.preventDefault()
  }
  contents.on('will-navigate', (event, url) => guard(event, url))
  contents.on('will-redirect', (event, url) => guard(event, url))
}

// Geçici ağ hataları (Chromium net hata kodları): DNS çözülemedi, bağlantı yok/kesildi/zaman aşımı.
// V3'te giriş penceresi bir kez ERR_NAME_NOT_RESOLVED ile boş kaldı; böyle hatalarda bir kez yenilenir.
const TRANSIENT_NET_ERRORS: ReadonlySet<number> = new Set([
  -7, -21, -100, -101, -105, -106, -109, -118, -137
])
const ERR_ABORTED = -3
export const AUTH_RETRY_DELAY_MS = 1500

/** Giriş penceresinin `did-fail-load` / `reload` yüzeyi (testte sahte nesneyle değiştirilir). */
export interface LoadFailureSource {
  on(
    event: 'did-fail-load',
    listener: (
      event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame: boolean
    ) => void
  ): unknown
  reload(): void
  isDestroyed(): boolean
}

/**
 * Ana çerçevenin yükleme hatası maskeli URL'yle loglanır (sorgu developer token içerir) ve geçici
 * ağ hatasında sayfa bir kez yenilenir. Kalıcı hatada pencere açık kalır; kullanıcı kapatınca
 * MusicKit `authorize()` AUTHORIZATION_FAILED ile sonuçlanır.
 */
export function watchLoadFailures(
  contents: LoadFailureSource,
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms)
): void {
  let retried = false
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return
    const retry = !retried && TRANSIENT_NET_ERRORS.has(code)
    logError(
      'auth-window',
      new CoreError(
        'AUTH_WINDOW_LOAD_FAILED',
        `giriş sayfası yüklenemedi: ${description} (${code}) ← ${redactUrl(url)}${retry ? '; bir kez yenileniyor' : ''}`
      )
    )
    if (!retry) return
    retried = true
    schedule(() => {
      if (!contents.isDestroyed()) contents.reload()
    }, AUTH_RETRY_DELAY_MS)
  })
}

function attach(contents: WebContents, parent: BrowserWindow): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAppleAuthUrl(url)) {
      blocked('POPUP_BLOCKED', `popup engellendi: ${redactUrl(url)}`, 'auth-window')
      return { action: 'deny' }
    }
    noteAuthHost(hostOf(url))
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent,
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          devTools: __DEV_BUILD__
        }
      }
    }
  })

  // Açılan Apple penceresi de aynı kurallara tabidir (iç içe popup ve yönlendirmeler).
  contents.on('did-create-window', (child) => {
    restrictNavigation(child.webContents)
    watchLoadFailures(child.webContents)
    attach(child.webContents, child)
  })
}

/**
 * Giriş penceresinin seçenekleri: preload YOK (uygulama API'si Apple sayfasına açılmaz), sandbox,
 * uygulamanın bellek içi oturumu (Apple çerezleri diske yazılmaz, kapanışta silinir).
 */
export function authWindowOptions(
  parent: BrowserWindow | undefined,
  partition: string
): BrowserWindowConstructorOptions {
  return {
    ...(parent ? { parent } : {}),
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: __DEV_BUILD__
    }
  }
}

/** Yeni giriş penceresine yükleme hatası izleme ve iç içe popup politikası. */
export function hardenAuthWindow(win: BrowserWindow): void {
  watchLoadFailures(win.webContents)
  attach(win.webContents, win)
}
