import { describe, expect, it } from 'vitest'
import { MAX_LEAD_S, SmoothClock } from './smoothTime'

describe('akıcı çalma konumu', () => {
  it('çalarken bildirimler arasında süre kadar ilerler', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    expect(c.at(250, 200)).toBeCloseTo(10.25)
    expect(c.at(900, 200)).toBeCloseTo(10.9)
  })

  it('yuvarlanmış (biraz geride) bildirim çizgiyi geri götürmez', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    c.report(10, true, 600) // hâlâ "10" (tam saniye) → tahmin 10,6'da kalır
    expect(c.at(600, 200)).toBeCloseTo(10.6)
    c.report(11, true, 1000)
    expect(c.at(1100, 200)).toBeCloseTo(11.1)
  })

  it('ileri / geri sarma ve şarkı değişiminde yeniden hizalanır', () => {
    const c = new SmoothClock()
    c.report(100, true, 0)
    c.report(30, true, 500)
    expect(c.at(500, 200)).toBe(30)
    c.report(0, true, 1000)
    expect(c.at(1000, 200)).toBe(0)
  })

  it('bildirim gelmezse en fazla MAX_LEAD_S öne geçer; süreyi aşmaz; duraklamada sabit', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    expect(c.at(10_000, 200)).toBe(10 + MAX_LEAD_S)
    c.report(199.5, true, 20_000)
    expect(c.at(22_000, 200)).toBe(200)
    c.report(42, false, 30_000)
    expect(c.at(40_000, 200)).toBe(42)
  })
})
