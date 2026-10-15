import { describe, expect, it, vi } from 'vitest'
import {
  framelessWindowOptions,
  performWindowAction,
  watchWindowState,
  windowState,
  type ControllableWindow
} from './windowControls'

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>()
  const state = { maximized: false, focused: true }
  const win = {
    minimize: vi.fn(),
    maximize: vi.fn(() => void (state.maximized = true)),
    unmaximize: vi.fn(() => void (state.maximized = false)),
    isMaximized: () => state.maximized,
    isFocused: () => state.focused,
    close: vi.fn(),
    on: (e: string, l: () => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set())
      listeners.get(e)!.add(l)
    },
    off: (e: string, l: () => void) => void listeners.get(e)?.delete(l),
    fire: (e: string) => listeners.get(e)?.forEach((l) => l()),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    state
  }
  return win
}

describe('kendi pencere çubuğu (B1)', () => {
  it('çerçevesiz pencere; yeniden boyutlandırma ve yuvarlak köşeler açık', () => {
    expect(framelessWindowOptions()).toMatchObject({
      frame: false,
      resizable: true,
      roundedCorners: true
    })
  })

  it('eylemler: küçült, büyüt ↔ geri al, kapat', () => {
    const w = fakeWindow()
    const win = w as unknown as ControllableWindow
    performWindowAction(win, 'minimize')
    performWindowAction(win, 'toggleMaximize')
    expect(windowState(win)).toEqual({ maximized: true, focused: true })
    performWindowAction(win, 'toggleMaximize')
    performWindowAction(win, 'close')
    expect(w.minimize).toHaveBeenCalledTimes(1)
    expect(w.maximize).toHaveBeenCalledTimes(1)
    expect(w.unmaximize).toHaveBeenCalledTimes(1)
    expect(w.close).toHaveBeenCalledTimes(1)
  })

  it('durum değişince bildirir; dinleyiciler sökülür', () => {
    const w = fakeWindow()
    const states: unknown[] = []
    const off = watchWindowState(w, (s) => states.push(s))
    w.state.maximized = true
    w.fire('maximize')
    w.state.focused = false
    w.fire('blur')
    expect(states).toEqual([
      { maximized: true, focused: true },
      { maximized: true, focused: false }
    ])
    off()
    expect(w.count()).toBe(0)
  })
})
