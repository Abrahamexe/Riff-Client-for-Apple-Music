import { Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import type { PlayerCommand } from '@shared/ipc-contract'
import type { I18n } from '@shared/i18n'
import { trayIcon } from './icon'

// Tray (PLAN 1.8a): pencereyi göster, çal/duraklat, önceki/sonraki, çıkış. İkon: uygulama ikonu (icon.ts).

export interface TrayActions {
  show(): void
  command(command: PlayerCommand): void
  quit(): void
}

/** Menü şablonu (Electron'dan bağımsız test edilebilir). Metinler i18n'den gelir. */
export function trayMenuTemplate(i18n: I18n, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: i18n.t('tray.show'), click: () => actions.show() },
    { type: 'separator' },
    { label: i18n.t('tray.playPause'), click: () => actions.command({ type: 'togglePlay' }) },
    { label: i18n.t('tray.previous'), click: () => actions.command({ type: 'previous' }) },
    { label: i18n.t('tray.next'), click: () => actions.command({ type: 'next' }) },
    { type: 'separator' },
    { label: i18n.t('tray.quit'), click: () => actions.quit() }
  ]
}

/** Tray'i oluşturur; dil değişince menü yenilenir. Döndürülen fonksiyon tray'i kaldırır. */
export function createAppTray(i18n: I18n, actions: TrayActions): () => void {
  const tray = new Tray(trayIcon())
  const refresh = (): void => {
    tray.setToolTip(i18n.t('tray.tooltip'))
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(i18n, actions)))
  }
  refresh()
  // Windows: tek tık pencereyi gösterir; sağ tık menüyü açar.
  tray.on('click', () => actions.show())
  const offLocale = i18n.onChange(refresh)
  return () => {
    offLocale()
    tray.destroy()
  }
}
