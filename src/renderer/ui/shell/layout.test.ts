import { describe, expect, it } from 'vitest'
import {
  BUBBLE_SIZE,
  computeLayout,
  GUTTER,
  PLAYER_SIDE_INSET,
  RIGHT_MIN_WINDOW,
  overlaps,
  SIDEBAR_MIN_WINDOW,
  type ShellState
} from './layout'

const ALL: ShellState[] = []
for (const sidebarOpen of [true, false])
  for (const rightOpen of [true, false])
    for (const playerExpanded of [true, false]) ALL.push({ sidebarOpen, rightOpen, playerExpanded })

const SIZES = [
  { width: 760, height: 600 },
  { width: 1000, height: 700 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 }
]

describe('kabuk yerleşimi (B2)', () => {
  it('sol menü, oynatıcı ve sözler paneli hiçbir boyut ve durumda üst üste binmez', () => {
    for (const size of SIZES) {
      for (const state of ALL) {
        const l = computeLayout(size, state)
        const label = JSON.stringify({ size, state })
        if (l.sidebar) expect(overlaps(l.sidebar, l.player), label).toBe(false)
        if (l.right) {
          expect(overlaps(l.right, l.player), label).toBe(false)
          if (l.sidebar) expect(overlaps(l.right, l.sidebar), label).toBe(false)
        }
      }
    }
  })

  it('sol panel sağ panelin aynası: aynı üst ve alt, kapalıyken yok (2026-11-23)', () => {
    const l = computeLayout(
      { width: 1600, height: 900 },
      { sidebarOpen: true, rightOpen: true, playerExpanded: true }
    )
    expect(l.sidebar!.x).toBe(GUTTER)
    expect(l.sidebar!.y).toBe(l.right!.y)
    expect(l.sidebar!.y + l.sidebar!.height).toBe(l.right!.y + l.right!.height)
    expect(
      computeLayout(
        { width: 1600, height: 900 },
        { sidebarOpen: false, rightOpen: true, playerExpanded: true }
      ).sidebar
    ).toBeNull()
  })

  it('küçük oynatıcıda sol panel baloncuğun üstünde biter', () => {
    const l = computeLayout(
      { width: 1600, height: 900 },
      { sidebarOpen: true, rightOpen: false, playerExpanded: false }
    )
    expect(l.sidebar!.y + l.sidebar!.height).toBe(l.player.y - GUTTER)
  })

  it('ana ekran iki panelin de altına girmez (ikisi de iter); içerik boşluğu sabit', () => {
    const size = { width: 1600, height: 900 }
    for (const sidebarOpen of [true, false]) {
      const l = computeLayout(size, { sidebarOpen, rightOpen: true, playerExpanded: true })
      expect(size.width - l.main.right).toBeLessThanOrEqual(l.right!.x)
      if (l.sidebar) expect(l.main.left).toBeGreaterThanOrEqual(l.sidebar.x + l.sidebar.width)
      else expect(l.main.left).toBe(0)
      expect(l.mainPadding.left).toBe(24)
    }
  })

  it('içerik oynatıcının altından geçer ama son satırı görünür kalır (alt boşluk)', () => {
    const l = computeLayout(
      { width: 1280, height: 800 },
      { sidebarOpen: true, rightOpen: false, playerExpanded: true }
    )
    expect(l.mainPadding.bottom).toBeGreaterThanOrEqual(800 - l.player.y)
  })

  it('dar pencerede önce sözler, sonra sol menü kendiliğinden kapanır; tercih korunur', () => {
    const open: ShellState = { sidebarOpen: true, rightOpen: true, playerExpanded: true }
    expect(computeLayout({ width: RIGHT_MIN_WINDOW, height: 800 }, open).effective).toEqual(open)
    expect(computeLayout({ width: RIGHT_MIN_WINDOW - 1, height: 800 }, open).effective).toEqual({
      ...open,
      rightOpen: false
    })
    expect(computeLayout({ width: SIDEBAR_MIN_WINDOW - 1, height: 800 }, open).effective).toEqual({
      sidebarOpen: false,
      rightOpen: false,
      playerExpanded: true
    })
  })

  it('küçük oynatıcı sol altta baloncuk', () => {
    const l = computeLayout(
      { width: 1280, height: 800 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: false }
    )
    expect(l.player.x).toBe(GUTTER)
    expect(l.player.y + l.player.height).toBe(800 - GUTTER)
    expect(l.player.width).toBe(l.player.height)
  })

  it('açık oynatıcı çubuğu iki yandan 80 px içeride', () => {
    const l = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: true, rightOpen: false, playerExpanded: true }
    )
    expect(PLAYER_SIDE_INSET).toBe(80)
    expect(l.player.x).toBe(80)
    expect(l.player.x + l.player.width).toBe(1440 - 80)
  })

  it('kapalı oynatıcı sol altta 48 px baloncuk, kenarlardan GUTTER kadar içeride (2026-11-02)', () => {
    const l = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: false }
    )
    expect(BUBBLE_SIZE).toBe(48)
    expect(l.player).toEqual({ x: GUTTER, y: 900 - GUTTER - 48, width: 48, height: 48 })
  })

  it('oynatıcı içeriği açık çubuk genişliğinde sabit (en az 720); baloncukta da değişmez', () => {
    const open = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: true }
    )
    const bubble = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: false }
    )
    expect(open.playerContentWidth).toBe(1440 - 160)
    expect(bubble.playerContentWidth).toBe(open.playerContentWidth)
    expect(
      computeLayout(
        { width: 800, height: 600 },
        { sidebarOpen: false, rightOpen: false, playerExpanded: true }
      ).playerContentWidth
    ).toBe(720)
  })
})
