// Kabuk yerleşimi (PLAN_v5 B2): "yüzen cam sütunlar". Saf hesap (testli): pencere boyutu + panel
// durumları → her yüzeyin dikdörtgeni. Kurallar (geliştirici kararları):
//  - sol menü, alt oynatıcı ve sağ panel (sözler / Sıradaki) birbirinin üstüne binmez;
//  - ana ekran sola kadar uzanır; sol menü açıkken onun üstüne biner (geliştirici kararı, B3
//    geri bildirimi); sağ panelin altına girmez; oynatıcının ve arama çubuğunun altından geçer;
//  - dar pencerede önce sağ panel, sonra sol menü kendiliğinden kapanır (genişleyince geri açılır);
//  - kapalı sol menü sol üstte damla, küçük oynatıcı sol altta baloncuk.
// Ölçüler geliştiricinin onayına sunulan başlangıç değerleridir.

export const GUTTER = 12
const SIDEBAR_WIDTH = 248
const RIGHT_WIDTH = 340
const PLAYER_HEIGHT = 92
/** Açık oynatıcı çubuğunun sağ ve sol boşluğu (geliştirici kararı: "sağdan soldan biraz boşluk"). */
export const PLAYER_SIDE_INSET = 80
const BUBBLE_SIZE = 60
export const DROPLET_SIZE = 44
/** Üst şerit: arama çubuğu ve pencere düğmeleri. */
const TOP_STRIP = 60
/** Bu genişliğin altında sağ panel kendiliğinden kapanır. */
export const RIGHT_MIN_WINDOW = 1200
/** Bu genişliğin altında sol menü kendiliğinden damlaya döner. */
export const SIDEBAR_MIN_WINDOW = 1000

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellState {
  sidebarOpen: boolean
  rightOpen: boolean
  playerExpanded: boolean
}

export interface ShellLayout {
  /** Kullanıcı tercihi + pencere genişliğinden çıkan gerçek durum. */
  effective: ShellState
  /**
   * Açık sol menünün EN BÜYÜK dikdörtgeni; gerçek yükseklik içeriğe göre (kapalı bölümler küçültür,
   * geliştirici isteği 2026-10-14). Kapalıyken damla.
   */
  sidebar: Rect
  /** Sol menünün çıkabileceği en büyük yükseklik (açık / kapalı durumdan bağımsız). */
  sidebarMaxHeight: number
  player: Rect
  /** Sağ panel (sözler / Sıradaki) kapalıysa `null`. */
  right: Rect | null
  /** Ana ekranın yatay sınırları (kaydırma alanı tüm yüksekliği kullanır). */
  main: { left: number; right: number }
  /** Ana ekran içeriğinin üst/alt iç boşluğu (cam çubukların altından geçerken görünür kalsın). */
  mainPadding: { top: number; bottom: number; left: number }
}

export function computeLayout(
  viewport: { width: number; height: number },
  state: ShellState
): ShellLayout {
  const { width, height } = viewport
  const effective: ShellState = {
    sidebarOpen: state.sidebarOpen && width >= SIDEBAR_MIN_WINDOW,
    rightOpen: state.rightOpen && width >= RIGHT_MIN_WINDOW,
    playerExpanded: state.playerExpanded
  }

  const player: Rect = effective.playerExpanded
    ? {
        x: PLAYER_SIDE_INSET,
        y: height - GUTTER - PLAYER_HEIGHT,
        width: width - 2 * PLAYER_SIDE_INSET,
        height: PLAYER_HEIGHT
      }
    : { x: GUTTER, y: height - GUTTER - BUBBLE_SIZE, width: BUBBLE_SIZE, height: BUBBLE_SIZE }

  // Yan paneller oynatıcının (veya baloncuğun) üstünde biter: üst üste binme yok.
  const panelBottom = player.y - GUTTER

  const sidebar: Rect = effective.sidebarOpen
    ? { x: GUTTER, y: GUTTER, width: SIDEBAR_WIDTH, height: panelBottom - GUTTER }
    : { x: GUTTER, y: GUTTER, width: DROPLET_SIZE, height: DROPLET_SIZE }

  // Sağ panel: oynatıcı küçükken baloncuk solda olduğu için sağ panel en alta kadar uzanır.
  const rightBottom = effective.playerExpanded ? panelBottom : height - GUTTER
  const right: Rect | null = effective.rightOpen
    ? {
        x: width - GUTTER - RIGHT_WIDTH,
        y: TOP_STRIP,
        width: RIGHT_WIDTH,
        height: rightBottom - TOP_STRIP
      }
    : null

  const rightEdge = right ? width - right.x + GUTTER : 0
  return {
    effective,
    sidebar,
    sidebarMaxHeight: panelBottom - GUTTER,
    player,
    right,
    main: { left: 0, right: rightEdge },
    mainPadding: {
      top: TOP_STRIP + 8,
      // Oynatıcının açık hâline göre sabit: baloncuğa küçülünce sayfa yeniden dizilmez (B5 akıcılık:
      // değişen alt boşluk tüm sayfayı bir kez yeniden diziyordu, 28–42 ms'lik kare).
      bottom: PLAYER_HEIGHT + 2 * GUTTER,
      // Ana ekran ve içeriği sola kadar uzanır; açık menü içeriğin üstüne biner (geliştirici, B5
      // geri bildirimi: "ana ekran sol tarafa kadar gitsin"). İçerik her zaman damlanın sağından
      // başlar: menü açılıp kapanırken sayfa yeniden dizilmez (akıcılık).
      left: GUTTER + DROPLET_SIZE + 16
    }
  }
}

/** İki dikdörtgen kesişiyor mu (kenar teması kesişme sayılmaz). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
