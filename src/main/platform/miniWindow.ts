import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

// MiniPlayer penceresi (B12b, geliştirici kararı 2026-10-14): kare, çerçevesiz, kapak tüm pencereyi
// kaplar. Pencerenin tamamı sürüklenir (arayüzde düğmeler hariç); büyütülemez, oranı hep 1:1.
// Başlık alanına (sürükleme bölgesi) çift tık Windows'ta pencereyi büyütmek yerine ana pencereye
// döner. Pencere davranışı platforma özel → burada.

const MINI_DEFAULT_SIZE = 300
const MINI_MIN_SIZE = 200
const MINI_MAX_SIZE = 640
/** Ekran kenarından boşluk (px). */
const MINI_MARGIN = 24

/** Varsayılan konum: ana pencerenin ekranında sağ alt köşe (görev çubuğunun üstü). */
export function miniDefaultBounds(workArea: Rectangle, size = MINI_DEFAULT_SIZE): Rectangle {
  return {
    x: Math.round(workArea.x + workArea.width - size - MINI_MARGIN),
    y: Math.round(workArea.y + workArea.height - size - MINI_MARGIN),
    width: size,
    height: size
  }
}

/** MiniPlayer seçenekleri (güvenlik ayarları ayrıca eklenir). */
export function miniWindowOptions(
  bounds: Rectangle,
  alwaysOnTop: boolean
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    minimizable: true,
    roundedCorners: true,
    minWidth: MINI_MIN_SIZE,
    minHeight: MINI_MIN_SIZE,
    maxWidth: MINI_MAX_SIZE,
    maxHeight: MINI_MAX_SIZE,
    alwaysOnTop,
    // Ana pencere gizliyken uygulamanın görev çubuğundaki tek izi.
    skipTaskbar: false,
    backgroundColor: '#000000',
    title: 'MiniPlayer'
  }
}

/** Electron `BrowserWindow`'un MiniPlayer için kullandığımız yüzeyi (testte sahte pencere). */
export interface MiniWindowLike {
  getSize(): number[]
  setSize(width: number, height: number): void
  setAspectRatio(ratio: number): void
  setAlwaysOnTop(flag: boolean, level?: 'floating'): void
  hookWindowMessage?(message: number, callback: () => void): void
}

/** Windows: başlık (sürükleme) alanında sol çift tık. */
const WM_NCLBUTTONDBLCLK = 0x00a3

/** Oranı kare tutar; çift tıkta (yalnızca Windows'ta yakalanabilir) `onDoubleClick` çağrılır. */
export function setupMiniWindow(
  win: MiniWindowLike,
  onDoubleClick: () => void,
  platform: NodeJS.Platform = process.platform
): void {
  const [width = 0] = win.getSize()
  win.setAspectRatio(1)
  // Ölçüm (2026-10-14, ECS 44, Windows): çerçevesiz pencerede `setAspectRatio` genişliği hemen 8 px
  // daraltıyor (300×300 → 292×300); sonraki `setSize` kareyi koruyor.
  win.setSize(width, width)
  if (platform === 'win32') win.hookWindowMessage?.(WM_NCLBUTTONDBLCLK, onDoubleClick)
}

/** Ayar değişince (pencere açıkken). `floating`: diğer "üstte" pencerelerle aynı katman. */
export function setMiniOnTop(win: MiniWindowLike, onTop: boolean): void {
  win.setAlwaysOnTop(onTop, 'floating')
}
