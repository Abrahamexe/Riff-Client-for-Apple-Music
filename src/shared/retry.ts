import { CoreError } from './errors'

export interface RetryOptions {
  /** İlk denemeden sonraki en fazla yeniden deneme sayısı. */
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** Test için enjekte edilebilir. */
  sleep?: (ms: number) => Promise<void>
  /** 0..1 arası; test için sabitlenebilir. */
  random?: () => number
  onRetry?: (info: { attempt: number; delayMs: number; error: CoreError }) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Üstel geri çekilme + jitter. Sunucu `Retry-After` verdiyse o süre (üst sınırla) kullanılır. */
export function backoffDelay(
  attempt: number,
  error: CoreError,
  { baseDelayMs = 500, maxDelayMs = 15_000, random = Math.random }: RetryOptions = {}
): number {
  if (error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, maxDelayMs)
  const exp = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
  return Math.round(exp / 2 + random() * (exp / 2)) // "equal jitter"
}

/** Yalnızca `retryable` CoreError'ları (429, ağ yok, 5xx) tekrar dener; diğerleri hemen fırlatılır. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, sleep = defaultSleep, onRetry } = options
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof CoreError) || !err.retryable || attempt > retries) throw err
      const delayMs = backoffDelay(attempt, err, options)
      onRetry?.({ attempt, delayMs, error: err })
      await sleep(delayMs)
    }
  }
}
