import { describe, expect, it } from 'vitest'
import {
  applyAppearance,
  GLASS_ALPHA_CLEAR,
  GLASS_ALPHA_OPAQUE,
  glassAlpha,
  resolveTheme
} from './theme'

describe('tema (B1)', () => {
  it('Windows’u izle / açık / koyu', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('saydamlık 0 → en opak, 100 → en saydam; sınır dışı ve geçersiz değer kırpılır', () => {
    expect(glassAlpha(0)).toBe(GLASS_ALPHA_OPAQUE)
    expect(glassAlpha(100)).toBe(GLASS_ALPHA_CLEAR)
    expect(glassAlpha(50)).toBeCloseTo((GLASS_ALPHA_OPAQUE + GLASS_ALPHA_CLEAR) / 2, 3)
    expect(glassAlpha(-20)).toBe(GLASS_ALPHA_OPAQUE)
    expect(glassAlpha(500)).toBe(GLASS_ALPHA_CLEAR)
    expect(glassAlpha(Number.NaN)).toBe(GLASS_ALPHA_OPAQUE)
  })

  it('kök öğeye tema ve cam değişkeni yazılır', () => {
    const props = new Map<string, string>()
    const root = {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => void props.set(k, v), colorScheme: '' }
    }
    const theme = applyAppearance(
      root as unknown as HTMLElement,
      { theme: 'system', transparency: 100, rightPanel: 'none' },
      true
    )
    expect(theme).toBe('dark')
    expect(root.dataset['theme']).toBe('dark')
    expect(props.get('--glass-alpha')).toBe(String(GLASS_ALPHA_CLEAR))
    expect(root.style.colorScheme).toBe('dark')
  })
})
