// Kapak görselleri (PLAN 2.2): Apple CDN adresi uygulamanın disk önbelleği üzerinden istenir
// (main: artworkCache.ts, `app://renderer/__art`). Önbellek diske yazılır, sonraki açılışta ağa
// çıkılmaz. UI'dan bağımsızdır.

const ARTWORK_ENDPOINT = 'app://renderer/__art'

/**
 * Worker kart adreslerini 300×300 boyutlandırılmış verir (`…/300x300bb.jpg`). Apple CDN'inde
 * (`*.mzstatic.com/image/thumb/…`) son yol parçası boyuttur: büyük kapak (sanatçı görseli, geniş
 * istasyon kartı) ve küçük satır kapağı aynı adresin boyutu değiştirilerek istenir (editoryal liste
 * kapağı: `…/300x300SC.DN01.jpg?l=tr-TR`). B6 gözlemi:
 * `sr` istasyon görsellerini istenen orana göre Apple'ın kendisi düzenler (kare, 16:9).
 */
const SIZED_MZSTATIC =
  /^(https:\/\/[a-z0-9-]+\.mzstatic\.com\/image\/thumb\/.+\/)\d+x\d+([A-Za-z0-9.]*\.(?:jpg|jpeg|png|webp)(?:\?[^/]*)?)$/

const clampPx = (n: number): string => String(Math.max(16, Math.min(3000, Math.round(n))))

/** `{w}x{h}` şablonunu (ya da boyutlu Apple CDN adresini) boyutlandırır; https değilse `null`. */
export function sizedArtworkUrl(
  template: string | null | undefined,
  width = 512,
  height = width
): string | null {
  if (!template) return null
  const w = clampPx(width)
  const h = clampPx(height)
  const src = template.includes('{w}')
    ? template.replace('{w}', w).replace('{h}', h)
    : template.replace(SIZED_MZSTATIC, `$1${w}x${h}$2`)
  return src.startsWith('https://') ? src : null
}

/** Boyutlandırılmış kapağın önbellekli adresi; https değilse `null`. */
export function cachedArtworkUrl(
  template: string | null | undefined,
  width = 512,
  height = width
): string | null {
  const src = sizedArtworkUrl(template, width, height)
  return src === null ? null : `${ARTWORK_ENDPOINT}?u=${encodeURIComponent(src)}`
}
