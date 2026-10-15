import { describe, expect, it } from 'vitest'
import { extractPalette, rgbCss } from './palette'

function image(colors: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(colors.length * 4)
  colors.forEach((c, i) => out.set(c, i * 4))
  return out
}

describe('kapak paleti', () => {
  it('baskın canlı tonlar önce; gri/siyah/beyaz bulut olmaz', () => {
    const px = image([
      ...Array(50).fill([220, 30, 40, 255]), // kırmızı (çok)
      ...Array(20).fill([30, 60, 220, 255]), // mavi
      ...Array(80).fill([128, 128, 128, 255]), // gri (çok ama doygunluksuz)
      ...Array(40).fill([0, 0, 0, 255]), // siyah (atlanır)
      ...Array(40).fill([255, 255, 255, 255]) // beyaz (atlanır)
    ] as [number, number, number, number][])
    const p = extractPalette(px, 3)
    expect(p[0]).toEqual([220, 30, 40])
    expect(p.slice(0, 2)).toContainEqual([30, 60, 220])
    expect(p).toHaveLength(3)
  })

  it('renksiz kapakta koyu nötr; az renkte tekrar eder; saydam pikseller atlanır', () => {
    expect(extractPalette(image([[0, 0, 0, 255]]), 4)).toHaveLength(4)
    expect(extractPalette(image([[200, 100, 20, 255]]), 3)).toEqual([
      [200, 100, 20],
      [200, 100, 20],
      [200, 100, 20]
    ])
    expect(extractPalette(image([[200, 100, 20, 0]]), 2)).toHaveLength(2)
    expect(rgbCss([1, 2, 3], 0.5)).toBe('rgb(1 2 3 / 0.5)')
  })
})
