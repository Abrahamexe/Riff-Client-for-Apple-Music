import { logError } from './index'

// Global hata yakalayıcılar (PLAN 2.3): hiçbir hata yakalanmadan kaybolmaz. Main ve worker'da
// `process`, renderer'da `window` olaylarına bağlanır; hata katalog koduyla (APP_003 INTERNAL)
// loglanır. Süreç çökertilmez: supervisor ve SWR tasarımı toparlanmayı sağlar.

/** Node `process`'in kullandığımız yüzeyi. */
export interface ProcessErrorSource {
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

export function installProcessErrorHandlers(scope: string, proc: ProcessErrorSource): void {
  proc.on('uncaughtException', (error) =>
    logError(scope, error, 'INTERNAL', 'Yakalanmamış hata (uncaughtException).')
  )
  proc.on('unhandledRejection', (reason) =>
    logError(scope, reason, 'INTERNAL', 'İşlenmemiş promise reddi (unhandledRejection).')
  )
}

/** DOM `window`'un kullandığımız yüzeyi. */
export interface WindowErrorSource {
  addEventListener(
    type: 'error',
    listener: (event: { error?: unknown; message?: string }) => void
  ): void
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: { reason?: unknown }) => void
  ): void
}

export function installWindowErrorHandlers(scope: string, win: WindowErrorSource): void {
  win.addEventListener('error', (event) =>
    logError(scope, event.error ?? event.message, 'INTERNAL', 'Yakalanmamış hata (window.onerror).')
  )
  win.addEventListener('unhandledrejection', (event) =>
    logError(scope, event.reason, 'INTERNAL', 'İşlenmemiş promise reddi.')
  )
}
