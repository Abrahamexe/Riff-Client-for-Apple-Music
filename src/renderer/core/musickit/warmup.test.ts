import { describe, expect, it, vi } from 'vitest'
import { createWarmup } from './warmup'

describe('çalma bağlantısını ısıtma (renderer)', () => {
  it('main’den ısıtma ister; aralık dolmadan tekrar istemez; hata yutulur', async () => {
    let t = 1_000
    const request = vi.fn(async () => {
      throw new Error('ağ')
    })
    const warm = createWarmup({ now: () => t, request, minIntervalMs: 20_000 })
    expect(warm()).toBe(true)
    t += 19_999
    expect(warm()).toBe(false)
    t += 1
    expect(warm()).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    await Promise.resolve()
  })
})
