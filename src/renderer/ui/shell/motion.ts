import type { Transition } from 'motion/react'

// Su damlası hissi (B2, iOS 26). Geliştirici geri bildirimi (2026-10-13): "birden aşağı doğru büyüyor,
// yan tarafları yetişemiyor" → yükseklik ve genişlik AYNI yayla, aynı anda; damla sol üst köşeden
// yumuşakça büyür (sekme yok denecek kadar az). Kapanış biraz daha hızlı.

const SPRING_OPEN: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 220, damping: 28 }
const SPRING_CLOSE: Transition = { type: 'spring', stiffness: 320, damping: 34 }

/** Açılış ve kapanış: tüm boyutlar tek yayla birlikte. */
export function dropletTransition(opening: boolean): Transition {
  return opening ? SPRING_OPEN : SPRING_CLOSE
}

/**
 * Sol menü paneli (2026-11-02, geliştiricinin iOS bağlam menüsü videosu → Gemini'nin yazdığı tarif):
 * panel hep son boyutunda; aç/kapa tuşunun olduğu köşeye çivili (CSS `transform-origin`) ölçek +
 * opaklık + köşeye doğru küçük kayma. Açılış iOS yayı (hafif sekme), kapanış 160 ms hızlanan eğri.
 * Yalnızca transform + opaklık: her karede liste yeniden dizilmez.
 * 2026-11-23 (geliştirici: "sağ paneller gibi olsun"): tuş oynatıcının sol ucunda → köşe sol alt.
 */
export const sidebarPanelMotion = {
  initial: { opacity: 0, scale: 0.82, x: -10, y: 10 },
  animate: {
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    transition: { type: 'spring', stiffness: 450, damping: 30, mass: 0.7 }
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    x: -6,
    y: 6,
    transition: { duration: 0.16, ease: [0.32, 0, 0.67, 0] }
  }
} as const

/**
 * Sağ panel (sözler / Sıradaki / Bilgi): sol panelin aynası — sağ alttaki oynatıcı düğmelerinden büyür
 * (`transform-origin: bottom right`, CSS), kapanırken oraya küçülür.
 */
export const rightPanelMotion = {
  initial: { ...sidebarPanelMotion.initial, x: 10 },
  animate: sidebarPanelMotion.animate,
  exit: { ...sidebarPanelMotion.exit, x: 6 }
} as const

/** Motion'ın `onAnimationComplete` tanımı kapanış hedefi mi (opaklık 0'a giden). */
export function isExitDefinition(definition: unknown): boolean {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    (definition as { opacity?: unknown }).opacity === rightPanelMotion.exit.opacity
  )
}

/**
 * Yumuşak çıkış eğrisi (easeOutQuint): hızlı başlar, uzun ve sakin yerleşir (Apple arayüzleri gibi).
 * B5 akıcılık: geçişler doğrusal olmayan bu eğriyle.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

/**
 * İçerik, kap açıldıktan az sonra belirir; kapanırken hemen kaybolur. B5 akıcılık ölçümü: önceki
 * `filter: blur()` geçişi her karede metni yeniden rasterleştiriyordu (cam bulanıklığıyla birlikte
 * kare atlatıyordu); yalnızca opaklık + çok hafif ölçek (GPU'da birleştirilir).
 */
export const contentIn = {
  initial: { opacity: 0, scale: 0.985 },
  animate: { opacity: 1, scale: 1, transition: { delay: 0.1, duration: 0.3, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } }
} as const

/** Sayfa geçişi: yeni sayfa hafifçe yükselerek belirir, eskisi kısa sürede söner (aynı hücrede). */
export const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.36, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: 'easeOut' } }
} as const

/**
 * Hep takılı kalan içerik için görünürlük (B5 akıcılık: oynatıcı çubuğu ve baloncuk her geçişte
 * yeniden kurulmaz; gizliyken `visibility: hidden`, odak ve tıklama almaz).
 */
export function shownWhen(visible: boolean) {
  return visible
    ? {
        opacity: 1,
        scale: 1,
        visibility: 'visible' as const,
        transition: { delay: 0.1, duration: 0.3, ease: EASE_OUT }
      }
    : {
        opacity: 0,
        scale: 0.985,
        transition: { duration: 0.12, ease: 'easeIn' as const },
        transitionEnd: { visibility: 'hidden' as const }
      }
}
