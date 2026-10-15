import { CoreError, toCoreError } from '../errors'
import { withRetry, type RetryOptions } from '../retry'

// Tüm MusicKit API çağrıları `guarded()` içinden geçer (PLAN 1.9):
//   401/403  → önce developer token tazelenip bir kez denenir (2.3: dolmuş developer token yanlışlıkla
//              çıkış yaptırmasın); hâlâ 401/403 ise user token geçersiz: onUnauthorized + UNAUTHORIZED
//   429/ağ/5xx → üstel geri çekilmeyle yeniden dene
//   developer token süresi dolmuş → onDeveloperTokenExpired (yenile + configure) ve bir kez tekrar dene

export interface GuardHandlers {
  onUnauthorized?: (error: CoreError) => void | Promise<void>
  /** Yeni developer token alıp MusicKit.configure'ı tekrarlamalıdır. */
  onDeveloperTokenExpired?: () => Promise<void>
  retry?: RetryOptions
}

let handlers: GuardHandlers = {}

export function setGuardHandlers(next: GuardHandlers): void {
  handlers = next
}

/** `guarded()` dışındaki kaynaklardan (worker) gelen UNAUTHORIZED için aynı işleyiciyi çalıştırır. */
export async function notifyUnauthorized(error: CoreError): Promise<void> {
  await handlers.onUnauthorized?.(error)
}

export async function guarded<T>(
  fn: () => Promise<T>,
  message = 'İstek başarısız oldu.'
): Promise<T> {
  const run = (): Promise<T> =>
    withRetry(async () => {
      try {
        return await fn()
      } catch (e) {
        throw toCoreError(e, 'API_REQUEST_FAILED', message)
      }
    }, handlers.retry)

  try {
    return await run()
  } catch (err) {
    if (!(err instanceof CoreError)) throw err

    const refresh = handlers.onDeveloperTokenExpired
    if ((err.code === 'DEVELOPER_TOKEN_EXPIRED' || err.code === 'UNAUTHORIZED') && refresh) {
      await refresh()
      try {
        return await run() // yenilenen developer token ile bir kez daha
      } catch (retryErr) {
        if (retryErr instanceof CoreError && retryErr.code === 'UNAUTHORIZED') {
          await handlers.onUnauthorized?.(retryErr)
        }
        throw retryErr
      }
    }
    if (err.code === 'UNAUTHORIZED') {
      await handlers.onUnauthorized?.(err)
    }
    throw err
  }
}
