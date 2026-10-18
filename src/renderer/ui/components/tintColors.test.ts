import { describe, expect, it } from 'vitest'
import { tintColors } from './tintColors'

describe('sayfa tonu renkleri', () => {
  it('baskın ve ikinci renk; ikinci yoksa baskın', () => {
    expect(
      tintColors([
        [120, 20, 40],
        [10, 60, 120]
      ])
    ).toEqual({
      main: [120, 20, 40],
      accent: [10, 60, 120]
    })
    expect(tintColors([[120, 20, 40]])?.accent).toEqual([120, 20, 40])
  })

  it('çok açık renk koyulaştırılır (beyaz metin okunur), ton korunur', () => {
    const { main } = tintColors([[250, 240, 200]])!
    expect(0.299 * main[0] + 0.587 * main[1] + 0.114 * main[2]).toBeLessThanOrEqual(150.5)
    expect(main[0]).toBeGreaterThan(main[2])
  })

  it('palet yoksa ton yok', () => {
    expect(tintColors(null)).toBeNull()
    expect(tintColors([])).toBeNull()
  })
})
