import { describe, expect, it } from 'vitest'
import {
  computeLayout,
  DROPLET_SIZE,
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
        expect(overlaps(l.sidebar, l.player), label).toBe(false)
        if (l.right) {
          expect(overlaps(l.right, l.player), label).toBe(false)
          expect(overlaps(l.right, l.sidebar), label).toBe(false)
        }
      }
    }
  })

  it('içerik sola kadar: menü açık da kapalı da damlanın sağından başlar (menü üstüne biner)', () => {
    const open = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: true, rightOpen: false, playerExpanded: true }
    )
    const closed = computeLayout(
      { width: 1440, height: 900 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: true }
    )
    expect(closed.mainPadding.left).toBeGreaterThan(closed.sidebar.x + closed.sidebar.width)
    // İçeriğe göre küçülen menünün üst sınırı açık/kapalı durumda aynı (kapanış animasyonu sıçramasın).
    expect(closed.sidebarMaxHeight).toBe(open.sidebar.height)
    // Menü açılıp kapanınca içerik yeniden dizilmez.
    expect(open.mainPadding.left).toBe(closed.mainPadding.left)
    expect(open.mainPadding.left).toBeLessThan(open.sidebar.x + open.sidebar.width)
  })

  it('ana ekran sola kadar uzanır (sol menü üstüne biner); sağ panelin altına girmez', () => {
    const size = { width: 1600, height: 900 }
    for (const sidebarOpen of [true, false]) {
      const l = computeLayout(size, { sidebarOpen, rightOpen: true, playerExpanded: true })
      expect(l.main.left).toBe(0)
      expect(size.width - l.main.right).toBeLessThanOrEqual(l.right!.x)
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

  it('kapalı menü sol üstte damla; küçük oynatıcı sol altta baloncuk', () => {
    const l = computeLayout(
      { width: 1280, height: 800 },
      { sidebarOpen: false, rightOpen: false, playerExpanded: false }
    )
    expect(l.sidebar).toEqual({ x: GUTTER, y: GUTTER, width: DROPLET_SIZE, height: DROPLET_SIZE })
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
})
