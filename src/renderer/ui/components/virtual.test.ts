import { describe, expect, it } from 'vitest'
import { pagesFor, visibleRange } from './virtual'

describe('sanal liste (B4)', () => {
  it('yalnızca görünür satırlar + tampon', () => {
    expect(visibleRange({ scrollTop: 0, viewport: 560, listTop: 200 }, 56, 50_000, 4)).toEqual({
      start: 0,
      end: 11
    })
    // 10.000. satırın üstü: tampon kadar önce başlar, ekran kadar sürer
    const r = visibleRange(
      { scrollTop: 200 + 56 * 10_000, viewport: 560, listTop: 200 },
      56,
      50_000,
      4
    )
    expect(r).toEqual({ start: 9_996, end: 10_014 })
  })

  it('sınırlar: boş liste, sonun ötesi, liste henüz görünmüyor', () => {
    expect(visibleRange({ scrollTop: 0, viewport: 500, listTop: 0 }, 56, 0)).toEqual({
      start: 0,
      end: 0
    })
    expect(visibleRange({ scrollTop: 1e9, viewport: 500, listTop: 0 }, 56, 100)).toEqual({
      start: 100,
      end: 100
    })
    expect(visibleRange({ scrollTop: 0, viewport: 300, listTop: 2_000 }, 56, 100, 2)).toEqual({
      start: 0,
      end: 0
    })
  })

  it('aralığın sayfaları', () => {
    expect(pagesFor({ start: 95, end: 230 }, 100)).toEqual([0, 100, 200])
    expect(pagesFor({ start: 5, end: 5 }, 100)).toEqual([])
  })
})
