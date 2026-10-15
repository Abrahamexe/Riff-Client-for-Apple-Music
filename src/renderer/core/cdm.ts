import type { CdmStatus } from '@shared/types'
import { TypedEmitter } from './emitter'
import { CoreError } from './errors'

// Widevine CDM kapısı (PLAN 1.2R). Pencere CDM'i beklemeden açılır; çalma işlemleri CDM hazır
// olana kadar burada bekletilir. Hazır olmazsa açık bir hata (DRM_*) ile sonuçlanır.

/** CDM durumunun kaynağı (uygulamada preload → main). UI/IPC'den bağımsız tutulur. */
export interface CdmSource {
  getStatus(): Promise<CdmStatus>
  onStatus(listener: (status: CdmStatus) => void): () => void
}

export interface CdmGateOptions {
  /** `pending` durumunda en fazla bu kadar beklenir. İlk açılışta CDM indirmesi sürebilir. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

export class CdmGate extends TypedEmitter<{ status: CdmStatus }> {
  private current: CdmStatus = { state: 'pending' }
  private readonly timeoutMs: number
  private unsubscribe: (() => void) | null = null
  /** Push bildirimi ilk sorgudan önce gelirse eski sorgu sonucu onu ezmesin. */
  private pushed = false

  constructor(
    private readonly source: CdmSource,
    options: CdmGateOptions = {}
  ) {
    super()
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  get status(): CdmStatus {
    return this.current
  }

  /** Bildirimlere abone olur ve güncel durumu sorgular. */
  async start(): Promise<void> {
    this.unsubscribe ??= this.source.onStatus((status) => {
      this.pushed = true
      this.set(status)
    })
    const status = await this.source.getStatus()
    if (!this.pushed) this.set(status)
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** CDM hazırsa hemen döner; hazırlanıyorsa bekler; kurulamadıysa veya süre dolarsa CoreError fırlatır. */
  waitUntilReady(): Promise<void> {
    const settled = this.settle(this.current)
    if (settled) return settled
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new CoreError('DRM_NOT_READY', 'Widevine CDM hâlâ hazırlanıyor.'))
      }, this.timeoutMs)
      const off = this.on('status', (status) => {
        const result = this.settle(status)
        if (!result) return
        clearTimeout(timer)
        off()
        result.then(resolve, reject)
      })
    })
  }

  private settle(status: CdmStatus): Promise<void> | null {
    if (status.state === 'ready') return Promise.resolve()
    if (status.state === 'error') {
      return Promise.reject(
        new CoreError('DRM_UNAVAILABLE', `Widevine CDM kurulamadı: ${status.message}`)
      )
    }
    return null
  }

  private set(status: CdmStatus): void {
    this.current = status
    this.emit('status', status)
  }
}
