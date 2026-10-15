import { CoreError } from '@shared/errors'

// İptal yardımcıları (PLAN 3.A8). Arka plan istekleri `AbortSignal` ile iptal edilir; iptal bir
// hata değildir, `BG_CANCELLED` koduyla ayırt edilir (log: info) ve tekrar denenmez.

export function cancelledError(reason = 'istek iptal edildi'): CoreError {
  return new CoreError('BG_CANCELLED', `arka plan: ${reason}.`)
}

/** Sinyalin iptal nedeni: bizim `BG_CANCELLED`'ımız ya da (başka kaynaklı iptalde) yenisi. */
export function abortReason(signal: AbortSignal): CoreError {
  return signal.reason instanceof CoreError ? signal.reason : cancelledError()
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal)
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CoreError && err.code === 'BG_CANCELLED'
}

/** `ms` sonra çözülür; sinyal iptal edilirse hemen `BG_CANCELLED` ile reddedilir (geri çekilme uykusu). */
export function abortableSleep(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined
): Promise<void> {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}
