import { describe, expect, it } from 'vitest'
import { isExitDefinition, rightPanelMotion, sidebarPanelMotion } from './motion'

describe('yan panellerin açılışı (iOS bağlam menüsü tarifi)', () => {
  it('sol panel oynatıcıdaki tuşun olduğu sol alt köşeden açılır (2026-11-23)', () => {
    expect(sidebarPanelMotion.initial).toEqual({ opacity: 0, scale: 0.82, x: -10, y: 10 })
  })

  it('settles fully open on the iOS spring', () => {
    const { transition, ...target } = sidebarPanelMotion.animate
    expect(target).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 })
    expect(transition).toEqual({ type: 'spring', stiffness: 450, damping: 30, mass: 0.7 })
  })

  it('collapses back into the corner in 160 ms with an ease-in curve', () => {
    const { transition, ...target } = sidebarPanelMotion.exit
    expect(target).toEqual({ opacity: 0, scale: 0.85, x: -6, y: 6 })
    expect(transition).toEqual({ duration: 0.16, ease: [0.32, 0, 0.67, 0] })
  })

  it('offsets always point toward the bottom anchor (never away from it)', () => {
    for (const s of [
      sidebarPanelMotion.initial,
      sidebarPanelMotion.exit,
      rightPanelMotion.initial,
      rightPanelMotion.exit
    ]) {
      expect(s.y).toBeGreaterThan(0)
      expect(s.scale).toBeLessThan(1)
    }
    expect(sidebarPanelMotion.initial.x).toBeLessThan(0)
    expect(rightPanelMotion.initial.x).toBeGreaterThan(0)
  })

  it('right panel: same recipe, mirrored toward its bottom-right anchor', () => {
    expect(rightPanelMotion.initial).toEqual({ ...sidebarPanelMotion.initial, x: 10 })
    expect(rightPanelMotion.animate).toBe(sidebarPanelMotion.animate)
    expect(rightPanelMotion.exit).toEqual({ ...sidebarPanelMotion.exit, x: 6 })
  })

  it('kapanış hedefi ayırt edilir (ana ekran genişliği yalnızca açılış bitince değişir)', () => {
    expect(isExitDefinition(rightPanelMotion.exit)).toBe(true)
    expect(isExitDefinition(sidebarPanelMotion.exit)).toBe(true)
    expect(isExitDefinition(sidebarPanelMotion.animate)).toBe(false)
    expect(isExitDefinition('shown')).toBe(false)
  })
})
