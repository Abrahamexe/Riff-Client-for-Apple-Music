import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// "Kapaktan büyüme" sayfayı başlık kapağına göre hizalar (zoomOrigin.ts `HEADER_ART`). Kapak boyutu
// ya da başlık boşluğu CSS'te değişirse sabit de değişmeli; yoksa kapak karttan kayarak başlar.

const css = readFileSync(resolve(__dirname, '../../src/renderer/ui/styles/shell.css'), 'utf8')
const zoom = readFileSync(resolve(__dirname, '../../src/renderer/ui/shell/zoomOrigin.ts'), 'utf8')

describe('başlık kapağı sabitleri CSS ile aynı', () => {
  it('kapak 220 px, başlık üst boşluğu 8 px', () => {
    expect(css).toMatch(/\.collection-header \{[^}]*margin: 8px 0 /)
    expect(css).toMatch(/\.collection-header__art \{[^}]*width: 220px;/)
    expect(zoom).toContain('export const HEADER_ART = { x: 0, y: 8, size: 220 } as const')
  })
})
