import { describe, expect, it } from 'vitest'
import { DROPLET_SIZE } from './layout'
import {
  dropletGlassTransition,
  dropletSlot,
  dropletSlotTransition,
  SIDEBAR_PANEL_RADIUS,
  SIDEBAR_SLOT_INSET,
  MENU_ICON_LINES_Y,
  MENU_ICON_SPRING,
  menuIconLine,
  rightPanelMotion,
  sidebarPanelMotion
} from './motion'

describe('sidebarPanelMotion (2026-11-02 iOS bağlam menüsü tarifi, sol üst köşeye aynalı)', () => {
  it('opens from the top-left corner: compact, transparent, nudged up-left', () => {
    expect(sidebarPanelMotion.initial).toEqual({ opacity: 0, scale: 0.82, x: -10, y: -10 })
  })

  it('settles fully open on the iOS spring', () => {
    const { transition, ...target } = sidebarPanelMotion.animate
    expect(target).toEqual({ opacity: 1, scale: 1, x: 0, y: 0 })
    expect(transition).toEqual({ type: 'spring', stiffness: 450, damping: 30, mass: 0.7 })
  })

  it('collapses back into the corner in 160 ms with an ease-in curve', () => {
    const { transition, ...target } = sidebarPanelMotion.exit
    expect(target).toEqual({ opacity: 0, scale: 0.85, x: -6, y: -6 })
    expect(transition).toEqual({ duration: 0.16, ease: [0.32, 0, 0.67, 0] })
  })

  it('offsets always point toward the anchor (up-left, never away from it)', () => {
    for (const s of [sidebarPanelMotion.initial, sidebarPanelMotion.exit]) {
      expect(s.x).toBeLessThan(0)
      expect(s.y).toBeLessThan(0)
      expect(s.scale).toBeLessThan(1)
    }
  })

  it('menu icon: three lines when closed, an X centred on the middle line when open', () => {
    for (const i of [0, 1, 2] as const)
      expect(menuIconLine(i, false)).toEqual({ y: 0, rotate: 0, opacity: 1, scaleX: 1 })
    const top = menuIconLine(0, true)
    const bottom = menuIconLine(2, true)
    // Üst ve alt çizgi ortadaki çizginin yüksekliğine kayar, ters yönde 45° döner.
    expect(MENU_ICON_LINES_Y[0] + top.y).toBe(MENU_ICON_LINES_Y[1])
    expect(MENU_ICON_LINES_Y[2] + bottom.y).toBe(MENU_ICON_LINES_Y[1])
    expect([top.rotate, bottom.rotate]).toEqual([45, -45])
    expect(menuIconLine(1, true)).toMatchObject({ opacity: 0 })
  })

  it('menu icon moves on the same spring as the panel', () => {
    expect(MENU_ICON_SPRING).toBe(sidebarPanelMotion.animate.transition)
  })

  it('open toggle sits in a slot concentric with the panel corner', () => {
    // İç yarıçap = dış yarıçap − boşluk; düğme damlayla aynı boy.
    expect(DROPLET_SIZE / 2).toBe(SIDEBAR_PANEL_RADIUS - SIDEBAR_SLOT_INSET)
    expect(dropletSlot(true)).toEqual({ x: SIDEBAR_SLOT_INSET, y: SIDEBAR_SLOT_INSET })
    expect(dropletSlot(false)).toEqual({ x: 0, y: 0 })
    expect(dropletSlotTransition(true)).toBe(sidebarPanelMotion.animate.transition)
    expect(dropletSlotTransition(false)).toBe(sidebarPanelMotion.exit.transition)
  })

  it('right panel: same recipe, mirrored toward its bottom-right anchor', () => {
    expect(rightPanelMotion.initial).toEqual({ ...sidebarPanelMotion.initial, x: 10, y: 10 })
    expect(rightPanelMotion.animate).toBe(sidebarPanelMotion.animate)
    expect(rightPanelMotion.exit).toEqual({ ...sidebarPanelMotion.exit, x: 6, y: 6 })
  })

  it('droplet glass fades out faster than it returns', () => {
    expect(dropletGlassTransition(true)).toMatchObject({ duration: 0.12 })
    expect(dropletGlassTransition(false)).toMatchObject({ duration: 0.16 })
  })
})
