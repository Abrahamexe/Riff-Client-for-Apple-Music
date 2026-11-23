// Kabuk yerleşimi (PLAN_v5 B2): "yüzen cam sütunlar". Saf hesap (testli): pencere boyutu + panel
// durumları → her yüzeyin dikdörtgeni. Kurallar (geliştirici kararları):
//  - sol menü, alt oynatıcı ve sağ panel (sözler / Sıradaki) birbirinin üstüne binmez;
//  - 2026-11-23 (geliştirici: "sol menüyü sağ paneller gibi yap"): sol panel sağ panelin aynası —
//    üst şeritten oynatıcının üstüne kadar tam boy; açılınca ana ekranı iter (ikisinin de altına
//    girmez); oynatıcının ve arama çubuğunun altından geçer. Aç/kapa tuşu oynatıcının sol ucunda;
//  - dar pencerede önce sağ panel, sonra sol menü kendiliğinden kapanır (genişleyince geri açılır);
//  - küçük oynatıcı sol altta baloncuk.
// Ölçüler geliştiricinin onayına sunulan başlangıç değerleridir.

export const GUTTER = 12
export const SIDEBAR_WIDTH = 248
const RIGHT_WIDTH = 340
/** 2026-11-23: çalma tuşları şarkı kutusunun altına indi (ilerleme 22 + kutu 74 + boşluklar). */
const PLAYER_HEIGHT = 116
/** Açık oynatıcı çubuğunun sağ ve sol boşluğu (geliştirici kararı: "sağdan soldan biraz boşluk"). */
export const PLAYER_SIDE_INSET = 80
/** İçerik bu genişliğin altındaysa (pencere < 1200 px) tuşlar küçülür (`.player--narrow`). */
export const PLAYER_NARROW_BELOW = 1200 - 2 * PLAYER_SIDE_INSET
/** `.player__content`'in en dar genişliği (CSS'teki eski `max(720px, …)` ile aynı). */
const PLAYER_MIN_CONTENT = 720
/** 2026-11-02 (geliştirici: "sol altta çok küçük kalıyor"): oynatıcı baloncuğu 48 px, kenar 12 px. */
export const BUBBLE_SIZE = 48
/** Geri + Ana Sayfa düğmeleri (sol üst köşe, kenardan GUTTER). */
export const NAV_BUTTON_SIZE = 36
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
  /** Sol panel (menü) kapalıysa `null`. */
  sidebar: Rect | null
  player: Rect
  /**
   * Oynatıcı içeriğinin sabit genişliği (açık çubuğun genişliği; en az 720). Baloncuğa küçülünce de
   * değişmez: içerik yeniden dizilmeden kırpılır. CSS `vw` yerine buradan: kapla aynı işlemde güncellenir.
   */
  playerContentWidth: number
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

  // Sol panel: baloncuk sol altta olduğu için hep oynatıcının (ya da baloncuğun) üstünde biter.
  const sidebar: Rect | null = effective.sidebarOpen
    ? { x: GUTTER, y: TOP_STRIP, width: SIDEBAR_WIDTH, height: panelBottom - TOP_STRIP }
    : null

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
  const leftEdge = sidebar ? sidebar.x + sidebar.width + GUTTER : 0
  return {
    effective,
    sidebar,
    player,
    playerContentWidth: Math.max(PLAYER_MIN_CONTENT, width - 2 * PLAYER_SIDE_INSET),
    right,
    main: { left: leftEdge, right: rightEdge },
    mainPadding: {
      top: TOP_STRIP + 8,
      // Oynatıcının açık hâline göre sabit: baloncuğa küçülünce sayfa yeniden dizilmez (B5 akıcılık:
      // değişen alt boşluk tüm sayfayı bir kez yeniden diziyordu, 28–42 ms'lik kare).
      bottom: PLAYER_HEIGHT + 2 * GUTTER,
      // Sağdaki boşlukla aynı (Shell.tsx MAIN_PADDING_RIGHT); sol panel artık ana ekranı iter.
      left: 24
    }
  }
}

/** İki dikdörtgen kesişiyor mu (kenar teması kesişme sayılmaz). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
