import { describe, expect, it } from 'vitest'
import { CARD_GAP, fitCardWidth, MAX_CARD_GROWTH, shelfEdges, shelfTarget } from './shelfScroll'

describe('raf kaydırma (B4 ek)', () => {
  it('başta yalnızca ileri, ortada ikisi, sonda yalnızca geri; sığan rafta hiçbiri', () => {
    expect(shelfEdges({ scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      canPrevious: false,
      canNext: true
    })
    expect(shelfEdges({ scrollLeft: 500, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      canPrevious: true,
      canNext: true
    })
    expect(shelfEdges({ scrollLeft: 1199.5, clientWidth: 800, scrollWidth: 2000 })).toEqual({
      canPrevious: true,
      canNext: false
    })
    expect(shelfEdges({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 })).toEqual({
      canPrevious: false,
      canNext: false
    })
  })

  it('bir basış: görünen genişlik eksi bir kart; sınırlar aşılmaz', () => {
    const m = { scrollLeft: 0, clientWidth: 800, scrollWidth: 2000 }
    expect(shelfTarget(m, 1, 196)).toBe(604)
    expect(shelfTarget({ ...m, scrollLeft: 1000 }, 1, 196)).toBe(1200)
    expect(shelfTarget({ ...m, scrollLeft: 300 }, -1, 196)).toBe(0)
    // Kart görünen alandan genişse en az bir kart kayar.
    expect(shelfTarget({ scrollLeft: 0, clientWidth: 150, scrollWidth: 900 }, 1, 196)).toBe(196)
  })
})

describe('fitCardWidth', () => {
  it('fills the row with whole cards: no half card, never narrower than base', () => {
    // 1000 px: 5 x 176 + 4 x 20 = 960 fits, 6 cards need 1156 -> five cards share 1000 px
    expect(fitCardWidth(1000, 176)).toBe(184)
    // Exactly one card fits plus part of the second -> one card, full width
    expect(fitCardWidth(300, 176)).toBe(300)
    // Narrower than one card -> a single card of the available width
    expect(fitCardWidth(100, 176)).toBe(100)
    for (let w = 200; w < 2400; w += 37) {
      const card = fitCardWidth(w, 176)
      const count = Math.round((w + 20) / (card + 20))
      expect(card).toBeGreaterThanOrEqual(176)
      expect(count * card + (count - 1) * 20).toBeLessThanOrEqual(w)
      expect(w - (count * card + (count - 1) * 20)).toBeLessThan(1)
    }
  })
})

describe('fitCardWidth — az öğeli raf satırı doldurur (2026-11-02)', () => {
  const span = (card: number, n: number): number => n * card + (n - 1) * CARD_GAP

  it('5 öğe, 9 kart sığan satır: 5 kart satırı tam doldurur', () => {
    const card = fitCardWidth(1832, 266, 5)
    expect(span(card, 5)).toBeGreaterThan(1831)
    expect(span(card, 5)).toBeLessThanOrEqual(1832)
  })

  it('öğe sayısı sığandan fazlaysa davranış aynı (raf kayar)', () => {
    expect(fitCardWidth(1000, 176, 40)).toBe(fitCardWidth(1000, 176))
    expect(fitCardWidth(1000, 176, 5)).toBe(fitCardWidth(1000, 176))
  })

  it('1–2 öğede kart en fazla MAX_CARD_GROWTH × base olur', () => {
    for (const items of [1, 2, 3]) {
      const card = fitCardWidth(1832, 176, items)
      expect(card).toBeLessThanOrEqual(176 * MAX_CARD_GROWTH)
      expect(card).toBeGreaterThanOrEqual(176)
    }
  })
})
