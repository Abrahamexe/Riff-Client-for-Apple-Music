import { describe, expect, it } from 'vitest'
import {
  computeLayout,
  DOCK,
  overlaps,
  RIGHT_MIN_WINDOW,
  SIDEBAR,
  SIDEBAR_MIN_WINDOW,
  TOP
} from './layout'

const SIZES = [
  { width: 900, height: 600 },
  { width: 1000, height: 700 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
]

describe('kabuk yerleşimi (2026-11-27, tek tasarım)', () => {
  it('hiçbir boyut ve durumda yüzeyler üst üste binmez; oynatıcı alt kenarda tam genişlik', () => {
    for (const size of SIZES) {
      for (const rightOpen of [true, false]) {
        const l = computeLayout(size, { rightOpen })
        const label = JSON.stringify({ size, rightOpen })
        expect(l.player, label).toEqual({
          x: 0,
          y: size.height - DOCK,
          width: size.width,
          height: DOCK
        })
        if (l.sidebar) expect(overlaps(l.sidebar, l.player), label).toBe(false)
        if (l.right) {
          expect(overlaps(l.right, l.player), label).toBe(false)
          if (l.sidebar) expect(overlaps(l.right, l.sidebar), label).toBe(false)
        }
      }
    }
  })

  it('kitaplık sabit: geniş pencerede açık, dar pencerede yok', () => {
    const wide = computeLayout({ width: 1600, height: 900 }, { rightOpen: false })
    expect(wide.sidebar).toEqual({ x: 0, y: 0, width: SIDEBAR, height: 900 - DOCK })
    expect(wide.main.left).toBe(SIDEBAR)
    const narrow = computeLayout(
      { width: SIDEBAR_MIN_WINDOW - 1, height: 700 },
      { rightOpen: false }
    )
    expect(narrow.sidebar).toBeNull()
    expect(narrow.main.left).toBe(0)
  })

  it('sağ panel üst şeridin altından oynatıcıya kadar, ana ekranı iter; dar pencerede kapanır', () => {
    const l = computeLayout({ width: 1600, height: 900 }, { rightOpen: true })
    expect(l.right!.y).toBe(TOP)
    expect(l.right!.x + l.right!.width).toBe(1600)
    expect(l.right!.y + l.right!.height).toBe(l.player.y)
    expect(l.main.right).toBe(l.right!.width)
    const narrow = computeLayout({ width: RIGHT_MIN_WINDOW - 1, height: 800 }, { rightOpen: true })
    expect(narrow.right).toBeNull()
    expect(narrow.effective.rightOpen).toBe(false)
  })

  it('iç boşluk iki yanda eşit, şeritlerin altında içerik görünür kalır', () => {
    const l = computeLayout({ width: 1600, height: 900 }, { rightOpen: false })
    expect(l.mainPadding.left).toBe(l.mainPadding.right)
    expect(l.mainPadding.top).toBeGreaterThan(TOP)
    expect(l.mainPadding.bottom).toBeGreaterThan(DOCK)
  })
})
