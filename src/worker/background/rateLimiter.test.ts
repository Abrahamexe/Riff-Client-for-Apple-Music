import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter, type Priority } from './rateLimiter'

afterEach(() => vi.useRealTimers())

/** Kayan pencere denetimi: her [t, t+W) aralığında izin sayısı ≤ burst + perSecond·W. */
function assertNeverExceeds(starts: number[], perSecond: number, burst: number): void {
  const sorted = [...starts].sort((a, b) => a - b)
  for (const windowMs of [1, 250, 999, 1_000, 2_500, 10_000]) {
    const limit = burst + Math.floor((perSecond * windowMs) / 1000)
    for (let i = 0; i < sorted.length; i++) {
      let count = 0
      for (let j = i; j < sorted.length && sorted[j]! < sorted[i]! + windowMs; j++) count++
      expect(count, `pencere ${windowMs} ms @${sorted[i]}`).toBeLessThanOrEqual(limit)
    }
  }
}

describe('RateLimiter (3.A1)', () => {
  it('MusicBrainz ayarı (1/sn, burst 1): ani 15 istekte iki istek arası en az 1000 ms', async () => {
    vi.useFakeTimers()
    const limiter = new RateLimiter({ perSecond: 1, burst: 1, maxConcurrent: 1 })
    const starts: number[] = []
    const all = Array.from({ length: 15 }, () =>
      limiter.run(async () => void starts.push(Date.now()))
    )
    await vi.advanceTimersByTimeAsync(20_000)
    await Promise.all(all)
    expect(starts).toHaveLength(15)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1_000)
    }
    assertNeverExceeds(starts, 1, 1)
  })

  it('rastgele geliş, süre ve önceliklerde limit HİÇBİR pencerede aşılmaz', async () => {
    vi.useFakeTimers()
    // Tekrarlanabilir sözde rastgele (LCG).
    let seed = 42
    const rand = (): number => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
    for (const [perSecond, burst, maxConcurrent] of [
      [1, 1, 1],
      [0.8, 1, 1],
      [3, 3, 2],
      [5, 2, 4]
    ] as const) {
      const limiter = new RateLimiter({ perSecond, burst, maxConcurrent })
      const starts: number[] = []
      let active = 0
      let maxActive = 0
      const runs: Promise<void>[] = []
      for (let i = 0; i < 60; i++) {
        await vi.advanceTimersByTimeAsync(Math.floor(rand() * 900))
        const priority: Priority = rand() < 0.3 ? 'prefetch' : 'user'
        const duration = Math.floor(rand() * 1_500)
        runs.push(
          limiter.run(async () => {
            starts.push(Date.now())
            maxActive = Math.max(maxActive, ++active)
            await new Promise((r) => setTimeout(r, duration))
            active--
          }, priority)
        )
      }
      await vi.advanceTimersByTimeAsync(200_000)
      await Promise.all(runs)
      expect(starts).toHaveLength(60)
      expect(maxActive).toBeLessThanOrEqual(maxConcurrent)
      assertNeverExceeds(starts, perSecond, burst)
    }
  })

  it('eşzamanlılık limiti: uzun istekler bitmeden yenisi başlamaz', async () => {
    vi.useFakeTimers()
    const limiter = new RateLimiter({ perSecond: 100, burst: 10, maxConcurrent: 2 })
    let active = 0
    let maxActive = 0
    const runs = Array.from({ length: 6 }, () =>
      limiter.run(async () => {
        maxActive = Math.max(maxActive, ++active)
        await new Promise((r) => setTimeout(r, 1_000))
        active--
      })
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all(runs)
    expect(maxActive).toBe(2)
  })

  it('bekleyenler arasında kullanıcı isteği önceden yüklemeden önce geçer', async () => {
    vi.useFakeTimers()
    const limiter = new RateLimiter({ perSecond: 1, burst: 1, maxConcurrent: 1 })
    const order: string[] = []
    const run = (name: string, p: Priority) => limiter.run(async () => void order.push(name), p)
    const runs = [run('ilk', 'user'), run('ön-1', 'prefetch'), run('ön-2', 'prefetch')]
    runs.push(run('kullanıcı', 'user'))
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.all(runs)
    expect(order).toEqual(['ilk', 'kullanıcı', 'ön-1', 'ön-2'])
  })

  it('pause: kaynak duraklatılınca süre dolana kadar hiçbir istek başlamaz', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const limiter = new RateLimiter({ perSecond: 10, burst: 5, maxConcurrent: 5 })
    limiter.pause(5_000)
    limiter.pause(1_000) // daha kısa duraklatma öncekini kısaltmaz
    const starts: number[] = []
    const runs = Array.from({ length: 3 }, () =>
      limiter.run(async () => void starts.push(Date.now()))
    )
    await vi.advanceTimersByTimeAsync(4_999)
    expect(starts).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await Promise.all(runs)
    expect(starts.every((s) => s - t0 >= 5_000)).toBe(true)
  })

  it('fn hata verse de yuva bırakılır; geçersiz ayar reddedilir', async () => {
    vi.useFakeTimers()
    const limiter = new RateLimiter({ perSecond: 10, burst: 1, maxConcurrent: 1 })
    const failing = expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    const next = limiter.run(async () => 'ok')
    await vi.advanceTimersByTimeAsync(1_000)
    await failing
    await expect(next).resolves.toBe('ok')
    expect(() => new RateLimiter({ perSecond: 0, burst: 1, maxConcurrent: 1 })).toThrow()
  })

  it('iptal (3.A8): sırada bekleyen iptal edilirse jeton harcamaz; sıradaki istek erken değil, tam zamanında başlar', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const limiter = new RateLimiter({ perSecond: 1, burst: 1, maxConcurrent: 1 })
    const starts: Record<string, number> = {}
    const run = (name: string, signal?: AbortSignal) =>
      limiter.run(async () => void (starts[name] = Date.now() - t0), 'user', signal)
    const ctl = new AbortController()
    const a = run('a')
    const b = run('b', ctl.signal)
    const c = run('c')
    const bRejected = expect(b).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    await vi.advanceTimersByTimeAsync(0)
    expect(limiter.pending).toBe(2) // a jetonu aldı ama sırada; b ve c bekliyor
    ctl.abort()
    await bRejected
    expect(limiter.pending).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([a, c])
    expect(starts.b).toBeUndefined()
    // b jeton harcamış olsaydı c 2000 ms'de başlardı.
    expect(starts).toEqual({ a: 0, c: 1_000 })
  })

  it('iptal: jeton verildikten sonra ama istek başlamadan iptal edilirse jeton iade edilir', async () => {
    vi.useFakeTimers()
    const t0 = Date.now()
    const limiter = new RateLimiter({ perSecond: 1, burst: 1, maxConcurrent: 1 })
    const ctl = new AbortController()
    const fn = vi.fn(async () => 'x')
    const first = limiter.run(fn, 'user', ctl.signal) // jeton eşzamanlı verilir
    ctl.abort() // devam etmeden iptal
    await expect(first).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    expect(fn).not.toHaveBeenCalled()
    let startedAt = -1
    const second = limiter.run(async () => void (startedAt = Date.now() - t0))
    await vi.advanceTimersByTimeAsync(0)
    await second
    expect(startedAt).toBe(0) // jeton iade edildiği için beklemeden başladı
  })

  it('iptal: zaten iptal edilmiş sinyalle istek hiç kuyruğa girmez', async () => {
    const limiter = new RateLimiter({ perSecond: 1, burst: 1, maxConcurrent: 1 })
    const fn = vi.fn(async () => 'x')
    await expect(limiter.run(fn, 'user', AbortSignal.abort())).rejects.toMatchObject({
      code: 'BG_CANCELLED'
    })
    expect(fn).not.toHaveBeenCalled()
    expect(limiter.pending).toBe(0)
  })
})
