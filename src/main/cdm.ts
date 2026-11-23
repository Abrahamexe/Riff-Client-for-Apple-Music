import { logError } from '@shared/errors'
import type { CdmStatus } from '@shared/types'

// Widevine CDM durumu (PLAN 1.2R). ECS'de CDM bileşen güncelleyiciyle kurulur; ilk açılışta indirme
// sürebilir. Pencere bunu BEKLEMEZ: durum burada izlenir ve renderer'a `cdm:status` ile bildirilir.

export type CdmListener = (status: CdmStatus) => void

export class CdmStatusTracker {
  private status: CdmStatus = { state: 'pending' }
  private readonly listeners = new Set<CdmListener>()

  current(): CdmStatus {
    return this.status
  }

  /** Abonelikten çıkan bir fonksiyon döner. */
  onChange(listener: CdmListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** `whenReady`'yi arka planda bekler; asla reject etmez (hata durumu `error` olarak yayınlanır). */
  async track(whenReady: () => Promise<unknown>): Promise<void> {
    try {
      await whenReady()
      this.set({ state: 'ready' })
    } catch (err) {
      this.set({ state: 'error', message: describeError(err) })
    }
  }

  private set(next: CdmStatus): void {
    this.status = next
    for (const listener of [...this.listeners]) {
      try {
        listener(next)
      } catch (err) {
        logError('cdm', err, 'INTERNAL', 'CDM dinleyicisi hata verdi.')
      }
    }
  }
}

/** ECS `ComponentsError`: `errors` dizisindeki mesajlar birleştirilir; aksi halde Error.message. */
function describeError(err: unknown): string {
  const errors = (err as { errors?: unknown } | null)?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')
  }
  return err instanceof Error && err.message ? err.message : 'Widevine CDM kurulamadı.'
}
