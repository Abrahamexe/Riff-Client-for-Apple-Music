import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Kaydırma akıcılığı (2026-10-14 ölçümü): kartlarda tekrar eden öğelerin `backdrop-filter`'ı ve
// sonsuz animasyonu, görünmezken bile birer kompozit katman açıyordu ("Yeni" sayfasında 226 katman,
// 144 Hz ekranda kaydırma ~45–78 fps). Düzeltmeden sonra 20 katman, 144 fps. Bu koruma, kartta tekrar
// eden öğelerin TEMEL kurallarına bulanıklık / sonsuz animasyon geri gelmesin diye.

const css = readFileSync(resolve(__dirname, '../../src/renderer/ui/styles/shell.css'), 'utf8')

/** Seçicinin (tam eşleşen) temel kural gövdeleri. */
function rules(selector: string): string[] {
  const out: string[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const selectors = m[1]!
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((s) => s.trim())
    if (selectors.includes(selector)) out.push(m[2]!)
  }
  return out
}

describe('kaydırma katmanları', () => {
  it('kart düğmeleri yalnızca üzerine gelinince bulanıklaşır', () => {
    for (const sel of ['.card-more', '.media-card__play', '.more-button']) {
      for (const body of rules(sel)) expect(body, sel).not.toMatch(/backdrop-filter:\s*blur/)
    }
    expect(rules('.media-card__play.glass').join('')).toMatch(/backdrop-filter:\s*none/)
  })

  it('iskelet nabzı kutularda değil kapta', () => {
    for (const body of rules('.skeleton')) expect(body).not.toMatch(/animation:/)
  })
})
