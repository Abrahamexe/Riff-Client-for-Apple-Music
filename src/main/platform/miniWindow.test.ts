import { describe, expect, it, vi } from 'vitest'
import { miniDefaultBounds, miniWindowOptions, setMiniOnTop, setupMiniWindow } from './miniWindow'

describe('MiniPlayer penceresi (B12b)', () => {
  it('varsayılan konum: çalışma alanının sağ alt köşesi, kare', () => {
    expect(miniDefaultBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1596,
      y: 716,
      width: 300,
      height: 300
    })
    // İkinci ekran (eksi koordinat)
    expect(miniDefaultBounds({ x: -1280, y: 0, width: 1280, height: 984 }, 250)).toEqual({
      x: -274,
      y: 710,
      width: 250,
      height: 250
    })
  })

  it('çerçevesiz, büyütülemez, boyutu sınırlı; üstte kalma ayardan', () => {
    const o = miniWindowOptions({ x: 1, y: 2, width: 300, height: 300 }, true)
    expect(o).toMatchObject({
      x: 1,
      y: 2,
      width: 300,
      height: 300,
      show: false,
      frame: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true
    })
    expect(o.minWidth).toBeLessThan(o.maxWidth!)
    expect(miniWindowOptions({ x: 0, y: 0, width: 300, height: 300 }, false).alwaysOnTop).toBe(
      false
    )
  })

  it('oran kare; çift tık yalnızca Windows’ta pencere iletisiyle yakalanır', () => {
    const sized = () => ({
      getSize: vi.fn(() => [300, 300]),
      setSize: vi.fn(),
      setAspectRatio: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      hookWindowMessage: vi.fn()
    })
    const win = sized()
    const onDouble = vi.fn()
    setupMiniWindow(win, onDouble, 'win32')
    expect(win.setAspectRatio).toHaveBeenCalledWith(1)
    // Electron'un oranı uygularken daralttığı genişlik geri yazılır (kare).
    expect(win.setSize).toHaveBeenCalledWith(300, 300)
    expect(win.hookWindowMessage).toHaveBeenCalledWith(0x00a3, onDouble)

    const mac = sized()
    setupMiniWindow(mac, onDouble, 'darwin')
    expect(mac.hookWindowMessage).not.toHaveBeenCalled()

    setMiniOnTop(win, false)
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false, 'floating')
  })
})
