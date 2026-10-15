// Kaynak bazlı hız sınırlayıcı (PLAN 3.A1): token bucket + eşzamanlılık limiti + öncelik + duraklatma.
//  - Her istek başlamadan önce bir jeton harcar; jeton saniyede `perSecond` hızla, en fazla `burst`
//    kadar birikir. `burst: 1` ise iki istek arasında en az 1/perSecond saniye olur (MusicBrainz).
//  - Aynı anda en fazla `maxConcurrent` istek sürer.
//  - Bekleyenler arasında kullanıcı istekleri (`user`) önceden yüklemeden (`prefetch`) önce geçer.
//  - `pause(ms)`: kaynak 429/503 döndüğünde TÜM istekler o süre bekler (kaynak geneli geri çekilme).
//  - İptal (PLAN 3.A8): sırada bekleyen istek iptal edilirse kuyruktan çıkar ve JETON HARCAMAZ; jeton
//    verildikten sonra ama `fn` başlamadan iptal edilirse jeton iade edilir. `fn` başlamışsa (istek ağa
//    çıktı) jeton harcanmıştır; `fn` kendi sinyaliyle isteği keser.
// Jetonlar tek bir pompa döngüsünde dağıtılır; saat ve uyku enjekte edilebilir (testlerde sahte saat).
import { abortReason, throwIfCancelled } from './abort'

export type Priority = 'user' | 'prefetch'

export interface RateLimiterOptions {
  /** Saniyede eklenen jeton (ortalama en yüksek istek hızı). */
  perSecond: number
  /** Kovada en fazla biriken jeton (ani istek sayısı). */
  burst: number
  maxConcurrent: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

interface Waiter {
  priority: Priority
  seq: number
  resolve: () => void
  /** Jeton verildi (kuyruktan çıktı). */
  granted: boolean
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export class RateLimiter {
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private tokens: number
  private lastRefill: number
  private pausedUntil = 0
  private active = 0
  private seq = 0
  private pumping = false
  private readonly waiters: Waiter[] = []

  constructor(private readonly options: RateLimiterOptions) {
    if (!(options.perSecond > 0) || !(options.burst >= 1) || !(options.maxConcurrent >= 1)) {
      throw new RangeError('Geçersiz hız sınırı.')
    }
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.tokens = options.burst
    this.lastRefill = this.now()
  }

  /** Sırası gelince `fn`'i çalıştırır; jeton ve eşzamanlılık yuvası `fn` bitince bırakılır. */
  async run<T>(
    fn: () => Promise<T>,
    priority: Priority = 'user',
    signal?: AbortSignal
  ): Promise<T> {
    throwIfCancelled(signal)
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { priority, seq: this.seq++, resolve, granted: false }
      const onAbort = (): void => {
        if (waiter.granted) return // jeton verildi; aşağıdaki denetim iade eder
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        reject(abortReason(signal!))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      waiter.resolve = () => {
        waiter.granted = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      this.waiters.push(waiter)
      this.pump()
    })
    if (signal?.aborted) {
      // Jeton verildi ama istek hiç başlamadı: harcama sayılmaz.
      this.tokens = Math.min(this.options.burst, this.tokens + 1)
      this.active--
      this.pump()
      throw abortReason(signal)
    }
    try {
      return await fn()
    } finally {
      this.active--
      this.pump()
    }
  }

  /** Kaynak geneli duraklatma (429/503, Retry-After). Daha uzun süre varsa kısaltılmaz. */
  pause(ms: number): void {
    if (!(ms > 0)) return
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms)
  }

  /** Bekleyen istek sayısı (test ve tanılama). */
  get pending(): number {
    return this.waiters.length
  }

  private refill(): void {
    const now = this.now()
    const elapsed = Math.max(0, now - this.lastRefill)
    this.tokens = Math.min(
      this.options.burst,
      this.tokens + (elapsed * this.options.perSecond) / 1000
    )
    this.lastRefill = now
  }

  /** Bir sonraki jeton için beklenecek süre (ms, yukarı yuvarlanır: limit asla erken açılmaz). */
  private waitMs(): number {
    this.refill()
    const paused = this.pausedUntil - this.now()
    const forToken = this.tokens >= 1 ? 0 : ((1 - this.tokens) * 1000) / this.options.perSecond
    return Math.ceil(Math.max(0, paused, forToken))
  }

  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    void this.loop()
  }

  private async loop(): Promise<void> {
    try {
      while (this.waiters.length > 0 && this.active < this.options.maxConcurrent) {
        const wait = this.waitMs()
        if (wait > 0) {
          await this.sleep(wait)
          continue
        }
        this.tokens -= 1
        this.active++
        this.takeNext().resolve()
      }
    } finally {
      this.pumping = false
    }
  }

  /** Önce kullanıcı istekleri, aynı öncelikte geliş sırası. */
  private takeNext(): Waiter {
    let best = 0
    for (let i = 1; i < this.waiters.length; i++) {
      const w = this.waiters[i]!
      const b = this.waiters[best]!
      if (
        (w.priority === 'user' && b.priority === 'prefetch') ||
        (w.priority === b.priority && w.seq < b.seq)
      ) {
        best = i
      }
    }
    return this.waiters.splice(best, 1)[0]!
  }
}
