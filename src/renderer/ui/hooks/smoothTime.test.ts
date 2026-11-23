import { describe, expect, it } from 'vitest'
import { CATCH_UP_S, MAX_LEAD_S, SmoothClock } from './smoothTime'

describe('akıcı çalma konumu', () => {
  it('çalarken bildirimler arasında süre kadar ilerler', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    expect(c.at(250, 200)).toBeCloseTo(10.25)
    expect(c.at(900, 200)).toBeCloseTo(10.9)
  })

  it('küçük fark zıplamadan, CATCH_UP_S içinde kapatılır', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    c.report(10.6, true, 400) // tahmin 10,4; bildirim 0,2 sn önde
    expect(c.at(400, 200)).toBeCloseTo(10.4) // bildirim anında sıçrama yok
    // 0,75 sn sonra farkın yarısı kapanmış: 10,4 + 0,75 + 0,1.
    expect(c.at(400 + (CATCH_UP_S / 2) * 1000, 200)).toBeCloseTo(11.25)
    c.report(11.5, true, 1300) // tahmin 10,4 + 0,9 + 0,12 = 11,42: kalan fark yenisiyle değişir
    expect(c.at(1300, 200)).toBeCloseTo(11.42)
  })

  it('geride kalan bildirim çizgiyi geri götürmez', () => {
    const c = new SmoothClock()
    c.report(10, true, 0)
    c.report(10, true, 600) // hâlâ 10 → tahmin 10,6'dan devam eder, yavaşlayarak hizalanır
    let prev = c.at(600, 200)
    expect(prev).toBeCloseTo(10.6)
    for (let now = 616; now <= 1200; now += 16) {
      const t = c.at(now, 200)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
    // 10,6 + 0,6 − 0,6 × 0,6 / CATCH_UP_S
    expect(c.at(1200, 200)).toBeCloseTo(10.96)
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
