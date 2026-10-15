// Karttan büyüyen sayfa (geliştirici kararı 2026-10-14: "albüm kapağı olduğu yerden kayıp sayfa öyle
// açılsın, Apple Music iOS gibi"). Kart basılınca (pointerdown, tıklamadan ~100 ms önce) kapağın
// ekrandaki yeri kaydedilir; yeni albüm / liste / sanatçı sayfası o yerde ve ölçekte başlayıp yayla tam
// boyuta büyür, geri dönünce aynı yere küçülür. Yalnızca `transform` + opaklık (GPU'da birleşir).

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Kayıt bu süreden eskiyse kullanılmaz (kart basılıp başka bir yolla gidildiyse). */
export const ORIGIN_TTL_MS = 2_000

let pending: { box: Box; at: number } | null = null

export function setZoomOrigin(el: Element, now = performance.now()): void {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return
  pending = { box: { x: r.left, y: r.top, width: r.width, height: r.height }, at: now }
}

/** Bekleyen kart kutusunu bir kez verir (eskiyse `null`). */
export function takeZoomOrigin(now = performance.now()): Box | null {
  const p = pending
  pending = null
  return p && now - p.at <= ORIGIN_TTL_MS ? p.box : null
}

/**
 * Albüm / playlist sayfa başlığındaki kapağın sayfaya göre yeri ve boyutu (shell.css
 * `.collection-header` üst boşluğu 8 px, `.collection-header__art` 220 px; zoomOrigin.test.ts denetler).
 */
export const HEADER_ART = { x: 0, y: 8, size: 220 } as const

/**
 * Başlık kapağını karta oturtan dönüşüm (geliştirici geri bildirimi 2026-10-14: kapak "birden çok
 * uçuyor sonra yerine oturuyor"): sayfa, başlıktaki kapağı tam kartın yerinde ve boyutunda olacak
 * şekilde ölçeklenip kaydırılır; büyürken kapak karttan başlığa kesintisiz gider (ayrı uçuş yok).
 */
export function anchoredZoomTransform(
  origin: Box,
  page: Pick<Box, 'x' | 'y'>,
  anchor: { x: number; y: number; size: number } = HEADER_ART
): { x: number; y: number; scale: number } {
  const scale = Math.min(3, Math.max(0.05, origin.width / anchor.size))
  return {
    x: origin.x - page.x - scale * anchor.x,
    y: origin.y - page.y - scale * anchor.y,
    scale
  }
}

/**
 * Sayfanın (sol üst köşeden ölçeklenen) başlangıç dönüşümü: sayfanın sol üstü kartın sol üstüne,
 * genişliği kartın genişliğine oturur.
 */
export function zoomTransform(origin: Box, page: Box): { x: number; y: number; scale: number } {
  const scale = page.width > 0 ? Math.min(1, Math.max(0.05, origin.width / page.width)) : 1
  return { x: origin.x - page.x, y: origin.y - page.y, scale }
}

/**
 * Geri dönüşte kapağın uçacağı karttaki kapak (geliştirici geri bildirimi 2026-10-15: "kapanırken
 * şarkı listesi ortada donup kapanıyor; kapak kayıp yerine gitsin"): dönülen sayfadaki kapaklardan
 * kutusu açılıştaki kart kutusuna en yakın olanı (merkez farkı ve boyut farkı `tolerance` içinde).
 */
export function closestBox<T>(
  target: Box,
  candidates: readonly { item: T; box: Box }[],
  tolerance = 24
): T | null {
  const cx = target.x + target.width / 2
  const cy = target.y + target.height / 2
  let best: T | null = null
  let bestDist = Infinity
  for (const { item, box } of candidates) {
    if (Math.abs(box.width - target.width) > tolerance) continue
    const d = Math.hypot(box.x + box.width / 2 - cx, box.y + box.height / 2 - cy)
    if (d <= tolerance && d < bestDist) {
      best = item
      bestDist = d
    }
  }
  return best
}
