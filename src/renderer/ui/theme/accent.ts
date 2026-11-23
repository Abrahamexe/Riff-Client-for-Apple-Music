import type { Rgb } from '../nowplaying/palette'

// Tuş rengi kapaktan (2026-10-30, geliştirici kararı: kırmızı #fa2d48 yerine "kapaktan gelen renk").
// Çalan şarkının kapak paletinden en canlı renk seçilir; okunabilir kalsın diye tona dokunulmadan
// doygunluk ve açıklık sınırlanır, zemine karşı en az 4,5:1 kontrast sağlanır (WCAG AA, küçük metin).
// Renksiz (siyah-beyaz) kapakta ya da kapak yokken `null`: CSS'teki nötr renk (koyuda beyaz, açıkta
// koyu gri) kalır. Sil / hata / CANLI gibi uyarı renkleri bundan etkilenmez (`--danger`).

export interface AccentVariant {
  accent: Rgb
  /** Vurgu renginin üstündeki metin / simge (düğme içi). */
  onAccent: Rgb
}

export interface CoverAccent {
  dark: AccentVariant
  light: AccentVariant
}

/** Tema zeminleri (ui.css `--bg`). */
const DARK_BG: Rgb = [11, 11, 14]
const LIGHT_BG: Rgb = [243, 243, 246]
export const MIN_CONTRAST = 4.5
/** Bundan soluk renk "renksiz" sayılır (gri, siyah-beyaz kapak). */
const MIN_SATURATION = 0.2

export function coverAccent(palette: readonly Rgb[] | null): CoverAccent | null {
  if (!palette) return null
  const vivid = palette
    .map(rgbToHsl)
    .find((c) => c.s >= MIN_SATURATION && c.l >= 0.08 && c.l <= 0.95)
  if (!vivid) return null
  const dark = readable(vivid.h, clamp(vivid.s, 0.5, 0.9), clamp(vivid.l, 0.6, 0.74), DARK_BG, 1)
  const light = readable(
    vivid.h,
    clamp(vivid.s, 0.5, 0.9),
    clamp(vivid.l, 0.32, 0.45),
    LIGHT_BG,
    -1
  )
  return { dark: variant(dark), light: variant(light) }
}

/** Kontrast yetene kadar açıklığı zeminden uzaklaştırır (`dir` 1 açar, -1 koyulaştırır). */
function readable(h: number, s: number, l: number, bg: Rgb, dir: 1 | -1): Rgb {
  let lightness = l
  let rgb = hslToRgb(h, s, lightness)
  while (contrast(rgb, bg) < MIN_CONTRAST && lightness > 0.05 && lightness < 0.95) {
    lightness += 0.02 * dir
    rgb = hslToRgb(h, s, lightness)
  }
  return rgb
}

function variant(accent: Rgb): AccentVariant {
  // Açık vurguda koyu, koyu vurguda beyaz yazı (hangisi daha okunaklıysa).
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [17, 17, 20]
  return { accent, onAccent: contrast(accent, white) >= contrast(accent, black) ? white : black }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** WCAG göreli parlaklık. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbToHsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
