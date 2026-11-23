// Kayan yazının zamanlaması (Marquee.tsx). Saf mantık: test edilebilir.

/** İki kopya arasındaki boşluk (px); CSS `.marquee__track` `gap` ile aynı olmalı. */
export const MARQUEE_GAP_PX = 56
/** Kayma hızı (px/sn). */
export const MARQUEE_SPEED_PX_S = 36
/**
 * Her turun başında metnin durduğu pay (%); CSS `@keyframes marquee` ile aynı olmalı (anahtar kare
 * seçicisinde değişken kullanılamıyor). Kayma hızı sabit kalsın diye tur süresi buna göre uzar.
 */
export const MARQUEE_HOLD_PERCENT = 20

export interface MarqueeTiming {
  /** Bir turda kayılan mesafe: metin + boşluk (ikinci kopya tam ilk kopyanın yerine gelir). */
  shiftPx: number
  /** Bir tur (bekleme + kayma), sn. */
  durationS: number
}

export function marqueeTiming(textWidthPx: number): MarqueeTiming {
  const shiftPx = Math.round(textWidthPx + MARQUEE_GAP_PX)
  const moveS = shiftPx / MARQUEE_SPEED_PX_S
  return {
    shiftPx,
    durationS: Math.round((moveS / (1 - MARQUEE_HOLD_PERCENT / 100)) * 100) / 100
  }
}
