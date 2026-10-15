import { nativeImage, type NativeImage } from 'electron'
import { APP_ICON_PNG } from './appIcon'

// Uygulama ikonu (Riff Client, "Pena r"; kaynak build/icon.svg). Paketli uygulamada exe ve kısayol
// ikonu build/icon.ico'dan gelir; bunlar tray ve pencere (dev dahil görev çubuğu) içindir.

const dataUrl = (size: number): string => {
  const png = APP_ICON_PNG[size]
  if (!png) throw new Error(`appIcon: ${size} px yok (npm run icons)`)
  return `data:image/png;base64,${png}`
}

/** Tray: 16 px (%100 ölçek) + 32 px (%200) temsilleri; Windows ekran ölçeğine göre seçer. */
export function trayIcon(): NativeImage {
  const image = nativeImage.createFromDataURL(dataUrl(16))
  image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, dataURL: dataUrl(32) })
  return image
}

/** Pencere ikonu (görev çubuğu, Alt+Tab): Windows büyükten küçültür. */
export function windowIcon(): NativeImage {
  return nativeImage.createFromDataURL(dataUrl(256))
}
