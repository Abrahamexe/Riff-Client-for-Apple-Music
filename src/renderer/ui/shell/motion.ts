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

// Sol menü (2026-10-19, iOS 26/27 "…" menüsü gibi; geliştirici: "açılış kapanış animasyonu iOS'a
// benzemiyor"): düğmenin içinden büyür, hafif yay payıyla (~%3) oturur; içerik köşeden ölçeklenerek
// belirir. Kapanış sıçramasız ve hızlı, içerik önce söner. `filter: blur()` denendi: açılışta en uzun
// kare 28 → 83 ms (cam bulanıklığıyla birlikte yeniden rasterleştirme), bu yüzden yok.
const MENU_OPEN: Transition = { type: 'spring', stiffness: 420, damping: 27, mass: 0.85 }
// Kapanış yayla değil eğriyle: yay durgunluktan başlar (ilk kareler "gecikmeli" hissettirir); iOS
// kapanışı hızlı başlar, düğmenin içine yumuşakça oturur.
const MENU_CLOSE: Transition = { type: 'tween', duration: 0.32, ease: [0.32, 0.72, 0, 1] }

export function menuTransition(opening: boolean): Transition {
  return opening ? MENU_OPEN : MENU_CLOSE
}

/**
 * Yumuşak çıkış eğrisi (easeOutQuint): hızlı başlar, uzun ve sakin yerleşir (Apple arayüzleri gibi).
 * B5 akıcılık: geçişler doğrusal olmayan bu eğriyle.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1]

export const menuContentIn = {
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: {
      opacity: { delay: 0.04, duration: 0.2, ease: EASE_OUT },
      scale: { type: 'spring', stiffness: 380, damping: 28, mass: 0.85 }
    }
  },
  // Kapanışta içerik kapla birlikte köşeye küçülür (açılışın tersi), kap bitmeden söner.
  exit: {
    opacity: 0,
    scale: 0.88,
    transition: {
      opacity: { duration: 0.16, ease: 'easeIn' },
      scale: { duration: 0.3, ease: [0.32, 0.72, 0, 1] }
    }
  }
} as const

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
