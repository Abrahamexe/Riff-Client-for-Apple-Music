// Platforma özel davranışlar (CLAUDE.md mimari sınırlar): `process.platform`, tray, medya tuşları,
// pencere davranışı ve yollar yalnızca bu klasörde. Önce Windows; macOS sonra.

import { Menu } from 'electron'
export { createAppTray, type TrayActions } from './tray'
export { watchSystemResume, type PowerSource } from './power'
export { resolveAppPaths, type AppPathSource, type AppPaths } from './paths'
export { openInDefaultBrowser } from './shell'
export { windowIcon } from './icon'
export {
  framelessWindowOptions,
  performWindowAction,
  watchWindowState,
  windowState,
  type ControllableWindow
} from './windowControls'
export { miniDefaultBounds, miniWindowOptions, setMiniOnTop, setupMiniWindow } from './miniWindow'

/** Electron `app.commandLine`'ın kullandığımız yüzeyi. */
export interface CommandLineLike {
  appendSwitch(name: string, value?: string): void
}

/**
 * Medya tuşları ve Windows medya overlay'i (SMTC): Chromium'un Media Session entegrasyonunu açar.
 * Renderer'daki Media Session API (core/musickit/mediaSession.ts) bu sayede tuşlara bağlanır.
 * `app.whenReady()` ÖNCESİNDE çağrılmalıdır.
 */
export function enableMediaKeyIntegration(commandLine: CommandLineLike): void {
  commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')
}

/**
 * Windows AppUserModelID: electron-builder.yml `appId` ile AYNI olmalı (testle denetlenir). Windows
 * medya paneli (SMTC) ve bildirimler uygulamayı bu kimlikle bulur; panele tıklayınca pencerenin
 * öne gelmesi kurulu sürümde (Başlat menüsü kısayolu bu kimliği taşır) çalışır (V6 → V9).
 */
export const APP_USER_MODEL_ID = 'com.riffclient.desktop'

export interface AppIdentitySource {
  setAppUserModelId(id: string): void
}

/** `app.whenReady()` öncesinde çağrılır. */
export function applyAppIdentity(app: AppIdentitySource): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
}

/** Tanılama paketi için işletim sistemi tanımı (ör. `win32 10.0.26200`); kişisel veri yok. */
export function platformDescription(): string {
  return `${process.platform} ${process.getSystemVersion()}`
}

/** Electron `app`'in `activate` olayı (macOS: dock simgesine tıklama). */
export interface ActivateSource {
  on(event: 'activate', listener: () => void): unknown
}

/** Uygulama yeniden etkinleştirildiğinde (macOS dock). Windows'ta tray tıklaması bu işi görür. */
export function onAppReactivate(app: ActivateSource, listener: () => void): void {
  if (process.platform === 'darwin') app.on('activate', listener)
}

/** Tüm pencereler kapanınca uygulama kapanmalı mı? macOS'ta uygulama dock'ta açık kalır. */
export function quitsWhenAllWindowsClosed(): boolean {
  return process.platform !== 'darwin'
}

/** Pencerenin dinleyebildiği sistem oturumu olayları (Electron `BrowserWindow`). */
export interface SessionEndSource {
  on(event: 'session-end', listener: () => void): unknown
}

/**
 * Windows'ta kapanış / yeniden başlatma / oturum kapatma: `before-quit` GELMEZ (Electron belgesi);
 * pencerenin `session-end` olayı kullanılır. Diğer platformlarda `before-quit` yeterlidir.
 */
export function onSystemSessionEnd(win: SessionEndSource, listener: () => void): void {
  if (process.platform === 'win32') win.on('session-end', listener)
}

/**
 * R4: Electron'un varsayılan menüsünü (File/Edit/View/Window) kaldırır. Çerçevesiz pencerede görünmese
 * de kısayolları çalışıyordu (Ctrl+Shift+I geliştirici araçları, Ctrl+R yeniden yükleme). Windows'ta
 * metin kutularındaki kopyala/yapıştır menüye bağlı değildir.
 */
export function removeApplicationMenu(): void {
  Menu.setApplicationMenu(null)
}
