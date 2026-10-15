import type { Transition } from 'motion/react'

// Su damlası hissi (B2, iOS 26). Geliştirici geri bildirimi (2026-10-13): "birden aşağı doğru büyüyor,
// yan tarafları yetişemiyor" → yükseklik ve genişlik AYNI yayla, aynı anda; damla sol üst köşeden
// yumuşakça büyür (sekme yok denecek kadar az). Kapanış biraz daha hızlı.

export const SPRING_OPEN: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 220, damping: 28 }
const SPRING_CLOSE: Transition = { type: 'spring', stiffness: 320, damping: 34 }

/** Açılış ve kapanış: tüm boyutlar tek yayla birlikte. */
export function dropletTransition(opening: boolean): Transition {
  return opening ? SPRING_OPEN : SPRING_CLOSE
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
