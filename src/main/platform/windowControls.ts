import type { BrowserWindowConstructorOptions } from 'electron'
import type { WindowAction, WindowState } from '@shared/ipc-contract'

// Kendi pencere çubuğumuz (PLAN_v5 B0/B1): Windows'un başlık çubuğu yok (çerçevesiz pencere); küçült /
// büyüt / kapat arayüzdeki düğmelerden IPC ile gelir. Pencere davranışı platforma özel → burada.

/** Ana pencere için çerçevesiz pencere seçenekleri (güvenlik ayarları ayrıca eklenir). */
export function framelessWindowOptions(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    // Pencere kenarından yeniden boyutlandırma ve Windows 11 yuvarlak köşeleri korunur.
    resizable: true,
    roundedCorners: true,
    // Arayüzün en dar düzeni (sol menü + içerik + oynatıcı) için alt sınır; B2'de gözden geçirilir.
    minWidth: 900,
    minHeight: 600
  }
}

/** Electron `BrowserWindow`'un kullandığımız yüzeyi (testte sahte pencere). */
export interface ControllableWindow {
  minimize(): void
  maximize(): void
  unmaximize(): void
  isMaximized(): boolean
  isFocused(): boolean
  close(): void
  on(event: WindowStateEvent, listener: () => void): unknown
  off(event: WindowStateEvent, listener: () => void): unknown
}

type WindowStateEvent = 'maximize' | 'unmaximize' | 'focus' | 'blur' | 'restore'
const STATE_EVENTS: readonly WindowStateEvent[] = [
  'maximize',
  'unmaximize',
  'focus',
  'blur',
  'restore'
]

export function performWindowAction(win: ControllableWindow, action: WindowAction): void {
  switch (action) {
    case 'minimize':
      win.minimize()
      return
    case 'toggleMaximize':
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return
    case 'close':
      // X = uygulamadan çık (V6 kararı): kapanış akışı (durum kaydı vb.) pencerenin `close`'unda.
      win.close()
      return
  }
}

export function windowState(win: ControllableWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused() }
}

/** Büyütme / odak değişince bildirir (büyüt düğmesinin ikonu, pasif pencere görünümü). */
export function watchWindowState(
  win: ControllableWindow,
  onState: (state: WindowState) => void
): () => void {
  const emit = (): void => onState(windowState(win))
  for (const event of STATE_EVENTS) win.on(event, emit)
  return () => {
    for (const event of STATE_EVENTS) win.off(event, emit)
  }
}
