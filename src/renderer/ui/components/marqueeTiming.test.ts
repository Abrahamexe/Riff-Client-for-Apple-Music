import { describe, expect, it } from 'vitest'
import {
  MARQUEE_GAP_PX,
  MARQUEE_HOLD_PERCENT,
  MARQUEE_SPEED_PX_S,
  marqueeTiming
} from './marqueeTiming'

describe('kayan yazı zamanlaması', () => {
  it('bir turda metin + boşluk kadar kayar; kayma bölümünde hız sabit', () => {
    const t = marqueeTiming(484)
    expect(t.shiftPx).toBe(484 + MARQUEE_GAP_PX)
    const moveS = t.durationS * (1 - MARQUEE_HOLD_PERCENT / 100)
    expect(t.shiftPx / moveS).toBeCloseTo(MARQUEE_SPEED_PX_S, 0)
  })

  it('uzun metin daha uzun sürer', () => {
    expect(marqueeTiming(1200).durationS).toBeGreaterThan(marqueeTiming(300).durationS)
  })
})
