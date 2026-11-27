// Kabuk yerleşimi. Saf hesap (testli): pencere boyutu + panel durumu → her yüzeyin dikdörtgeni.
// 2026-11-27 (geliştirici: "eski arayüzü tamamen atıyoruz"): tek tasarım, Gözlemevi. Yüzen cam
// sütunlar yerine kenarlara yaslı yüzeyler, aralarında ince çizgi:
//  - üst şerit (geri / ev, arama, pencere düğmeleri);
//  - sabit kitaplık solda, tam boy (pencere yeterince genişse hep açık);
//  - oynatıcı alt kenarda tam genişlik şerit;
//  - sağ panel (bilgi / sözler / Sıradaki) üst şeritle oynatıcı arasında; dar pencerede kapanır.
// Hiçbir yüzey diğerinin üstüne binmez; ana ekran kitaplık ve sağ panel arasında kalır.

/** Üst şerit yüksekliği. */
export const TOP = 56
/** Sabit kitaplık genişliği. */
export const SIDEBAR = 240
/** Alt şerit (oynatıcı) yüksekliği. */
export const DOCK = 88
const RIGHT = 360
/** Ana ekranın yatay iç boşluğu (iki yanda eşit). */
const PAD_X = 40
/** Bu genişliğin altında sağ panel kendiliğinden kapanır. */
export const RIGHT_MIN_WINDOW = 1200
/** Bu genişliğin altında kitaplık gizlenir. */
export const SIDEBAR_MIN_WINDOW = 1000
/** İçerik bu genişliğin altındaysa oynatıcı tuşları küçülür (`.player--narrow`). */
export const PLAYER_NARROW_BELOW = 1040
/** Geri + Ana Sayfa düğmesi (üst şeritte). */
export const NAV_BUTTON_SIZE = 32

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellState {
  rightOpen: boolean
}

export interface ShellLayout {
  /** Pencere genişliğinden çıkan gerçek durum. */
  effective: { sidebarOpen: boolean; rightOpen: boolean }
  /** Kitaplık; dar pencerede `null`. */
  sidebar: Rect | null
  player: Rect
  /** Sağ panel kapalıysa `null`. */
  right: Rect | null
  /** Ana ekranın yatay sınırları (kaydırma alanı tüm yüksekliği kullanır). */
  main: { left: number; right: number }
  /** Ana ekran içeriğinin iç boşluğu (şeritlerin altından geçerken görünür kalsın). */
  mainPadding: { top: number; bottom: number; left: number; right: number }
}

export function computeLayout(
  { width, height }: { width: number; height: number },
  state: ShellState
): ShellLayout {
  const effective = {
    sidebarOpen: width >= SIDEBAR_MIN_WINDOW,
    rightOpen: state.rightOpen && width >= RIGHT_MIN_WINDOW
  }
  const dockTop = height - DOCK
  const sidebar: Rect | null = effective.sidebarOpen
    ? { x: 0, y: 0, width: SIDEBAR, height: dockTop }
    : null
  const right: Rect | null = effective.rightOpen
    ? { x: width - RIGHT, y: TOP, width: RIGHT, height: dockTop - TOP }
    : null
  return {
    effective,
    sidebar,
    player: { x: 0, y: dockTop, width, height: DOCK },
    right,
    main: { left: sidebar ? sidebar.width : 0, right: right ? right.width : 0 },
    mainPadding: { top: TOP + 28, bottom: DOCK + 32, left: PAD_X, right: PAD_X }
  }
}

/** İki dikdörtgen kesişiyor mu (kenar teması kesişme sayılmaz). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
