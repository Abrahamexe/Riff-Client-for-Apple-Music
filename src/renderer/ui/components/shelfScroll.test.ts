import { describe, expect, it } from 'vitest'
import { shelfEdges, shelfTarget } from './shelfScroll'

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
