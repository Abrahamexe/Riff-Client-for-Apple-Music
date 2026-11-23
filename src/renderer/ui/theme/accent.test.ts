import { describe, expect, it } from 'vitest'
import type { Rgb } from '../nowplaying/palette'
import { contrast, coverAccent, MIN_CONTRAST } from './accent'

const DARK_BG: Rgb = [11, 11, 14]
const LIGHT_BG: Rgb = [243, 243, 246]

describe('coverAccent', () => {
  it('kapak yoksa ya da renksizse nötr renge bırakır (null)', () => {
    expect(coverAccent(null)).toBeNull()
    expect(
      coverAccent([
        [20, 20, 20],
        [128, 128, 128],
        [240, 240, 240]
      ])
    ).toBeNull()
  })

  it('paletin ilk canlı rengini seçer (gri olanı atlar)', () => {
    const a = coverAccent([
      [120, 120, 124],
      [30, 90, 220],
      [220, 40, 40]
    ])
    expect(a).not.toBeNull()
    const [r, g, b] = a!.dark.accent
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('her kapakta iki temada da zemine karşı okunur kontrast', () => {
    const samples: Rgb[] = [
      [10, 10, 120], // koyu lacivert
      [255, 240, 60], // açık sarı
      [200, 30, 60], // kırmızı
      [20, 120, 40], // yeşil
      [130, 40, 200], // mor
      [255, 160, 200] // pembe
    ]
    for (const c of samples) {
      const a = coverAccent([c])
      expect(a, String(c)).not.toBeNull()
      expect(contrast(a!.dark.accent, DARK_BG), `dark ${String(c)}`).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      )
      expect(contrast(a!.light.accent, LIGHT_BG), `light ${String(c)}`).toBeGreaterThanOrEqual(
        MIN_CONTRAST
      )
    }
  })

  it('düğme yazısı vurguya göre beyaz ya da koyu (okunaklı olanı)', () => {
    const yellow = coverAccent([[255, 240, 60]])!
    expect(yellow.dark.onAccent).toEqual([17, 17, 20])
    const navy = coverAccent([[10, 10, 120]])!
    expect(navy.light.onAccent).toEqual([255, 255, 255])
  })
})
