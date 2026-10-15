// Büyük oynatıcı arka planı (geliştirici kararı 2026-10-14: "albüm kapağı arka planla uysun"):
// kapağın küçültülmüş piksellerinden baskın ve canlı 4 renk. Ton (hue) 12 kutuya ayrılır; her kutunun
// ağırlığı piksel sayısı × doygunluk (gri / siyah / beyaz bulut gibi durmaz). Az renkli kapakta
// (siyah-beyaz) en sık tonlar yine döner; hiç renk yoksa koyu nötr.

export type Rgb = [number, number, number]

const BUCKETS = 12
const FALLBACK: Rgb[] = [
  [40, 40, 52],
  [28, 28, 36],
  [60, 56, 72],
  [20, 20, 26]
]

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

/** RGBA piksel dizisinden (ör. 32×32 `getImageData`) en fazla `count` renk. */
export function extractPalette(pixels: ArrayLike<number>, count = 4): Rgb[] {
  const buckets = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]!
    if (a < 128) continue
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    const { h, s, l } = rgbToHsl(r, g, b)
    if (l < 0.08 || l > 0.95) continue
    const w = 0.15 + s
    const k = buckets[Math.floor(h / (360 / BUCKETS)) % BUCKETS]!
    k.w += w
    k.r += r * w
    k.g += g * w
    k.b += b * w
  }
  const ranked = buckets
    .filter((k) => k.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, count)
    .map((k): Rgb => [Math.round(k.r / k.w), Math.round(k.g / k.w), Math.round(k.b / k.w)])
  if (ranked.length === 0) return FALLBACK.slice(0, count)
  // Az renkli kapakta da her bulutun bir rengi olsun.
  while (ranked.length < count) ranked.push(ranked[ranked.length % Math.max(1, ranked.length)]!)
  return ranked
}

export const rgbCss = ([r, g, b]: Rgb, alpha = 1): string => `rgb(${r} ${g} ${b} / ${alpha})`
