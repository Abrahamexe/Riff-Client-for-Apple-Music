import type { Rgb } from '../nowplaying/palette'

// Sayfa tonunun renkleri (PageTint.tsx). Saf mantık: test edilebilir.

/** Ana renk bu parlaklığın üstündeyse koyulaştırılır: beyaz metin ve açık kapaklarda okunurluk. */
const MAX_LUMA = 150

const luma = ([r, g, b]: Rgb): number => 0.299 * r + 0.587 * g + 0.114 * b

function darken(c: Rgb): Rgb {
  const l = luma(c)
  if (l <= MAX_LUMA) return c
  const k = MAX_LUMA / l
  return [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)]
}

/** Paletten ana renk (baskın) ve vurgu (ikinci renk; yoksa ana). Palet yoksa `null`. */
export function tintColors(palette: readonly Rgb[] | null): { main: Rgb; accent: Rgb } | null {
  const first = palette?.[0]
  if (!first) return null
  return { main: darken(first), accent: darken(palette[1] ?? first) }
}
