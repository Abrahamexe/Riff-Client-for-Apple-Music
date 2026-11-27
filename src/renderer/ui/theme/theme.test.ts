import { describe, expect, it } from 'vitest'
import { applyAppearance, resolveTheme } from './theme'

describe('tema (B1)', () => {
  it('Windows’u izle / açık / koyu', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('kök öğeye tema yazılır', () => {
    const root = {
      dataset: {} as Record<string, string>,
      style: { colorScheme: '' }
    }
    const theme = applyAppearance(
      root as unknown as HTMLElement,
      { theme: 'system', rightPanel: 'none' },
      true
    )
    expect(theme).toBe('dark')
    expect(root.dataset['theme']).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })
})
