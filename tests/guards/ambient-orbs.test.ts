import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Arka plan küreleri (2026-11-02, geliştirici: "ışıklar hareket etmiyor, hızlansın, daha fazla renk";
// "her açılışta farklı renkte, farklı yerden başlasın"): yedi küre, renk paletten satır içi, her biri kendi
// yolunda 10–16 sn'de döner. Akıcılık için yalnızca transform canlanır (filtre yok); hareket azaltmada durur.

const root = resolve(__dirname, '../../src/renderer/ui')
const css = readFileSync(resolve(root, 'styles/shell.css'), 'utf8')
const tokens = readFileSync(resolve(root, 'styles/ui.css'), 'utf8')
const ORBS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
// Renderer dosyası bu tsconfig'de değil: sayı metinden okunur.
const ORB_COUNT = Number(
  /ORB_COUNT = (\d+)/.exec(readFileSync(resolve(root, 'components/orbPalette.ts'), 'utf8'))?.[1]
)

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  expect(at, selector).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

describe('arka plan küreleri', () => {
  it('bileşenin seçtiği küre sayısı kadar CSS kuralı var; renk sabit değil, paletten', () => {
    expect(ORBS).toHaveLength(ORB_COUNT)
    expect(rule('.ambient-orb')).toContain('var(--orb-color')
    expect(tokens).not.toMatch(/--orb-[a-g]:/)
    expect(tokens.match(/--orb-alpha:/g)).toHaveLength(2)
  })

  it('her küre kendi yolunda 16 sn ya da daha hızlı döner; süreler farklı', () => {
    const durations = ORBS.map((o) => {
      const body = rule(`.ambient-orb--${o}`)
      expect(body).toContain(`animation-name: orb-drift-${o}`)
      return Number(/animation-duration:\s*([\d.]+)s/.exec(body)?.[1])
    })
    for (const d of durations) expect(d).toBeLessThanOrEqual(16)
    expect(new Set(durations).size).toBe(ORBS.length)
  })

  it('yalnızca transform canlanır (filtre yok); hareket azaltmada durur', () => {
    for (const o of ORBS) {
      const at = css.indexOf(`@keyframes orb-drift-${o}`)
      expect(at, o).toBeGreaterThan(-1)
      // Blok, sütun 0'daki kapanış parantezinde biter.
      const body = css.slice(at, css.indexOf('\n}', at))
      expect(body).toContain('transform')
      expect(body).not.toMatch(/filter|left:|top:|width:/)
    }
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\.ambient-orb\s*\{\s*animation: none;/
    )
  })
})
