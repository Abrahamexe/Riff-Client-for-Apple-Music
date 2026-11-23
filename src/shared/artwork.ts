// Kapak görseli disk önbelleğinin ortak kuralları (PLAN 2.2, PLAN_v5 A3.2). Main diskteki dosyayı
// sunar (`app://renderer/__art?u=…`), worker indirir ve yazar; ikisi aynı adres doğrulamasını ve
// dosya adını kullanır. Yalnızca Apple'ın görsel CDN'i kabul edilir.

export const ARTWORK_ROUTE = '/__art'
/** Kabul edilen görsel host'ları (gözlem: is1-ssl … is5-ssl.mzstatic.com). */
const ARTWORK_HOST = /^is[0-9]{1,2}-ssl\.mzstatic\.com$/
/**
 * B4 gözlemi (2026-10-13): kullanıcının yüklediği / Apple'ın ürettiği çalma listesi kapakları
 * `store-0NN.blobstore.apple.com` üzerinde, uzantısız (`…/image`) ve süreli imzalı S3 adresleri
 * (`X-Amz-Expires`); her senkronda yeni imza gelir.
 */
const BLOBSTORE_HOST = /^store-[0-9]{3}\.blobstore\.apple\.com$/
/** Uzantısız (blobstore) kapak: tür, sunarken ilk baytlardan belirlenir. */
export const SNIFFED_EXTENSION = 'img'
export const MAX_ARTWORK_URL_LENGTH = 2048
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024
export const ARTWORK_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

/** Worker'ın indirme sonucu: `invalid` → 400, `failed` → 502. */
export type ArtworkFetchResult = 'ok' | 'invalid' | 'failed'

/** Geçerli bir Apple kapak URL'si mi? Değilse `null` (istek reddedilir). */
export function parseArtworkSource(raw: string | null): URL | null {
  if (!raw || raw.length > MAX_ARTWORK_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (BLOBSTORE_HOST.test(url.hostname)) return url
  if (!ARTWORK_HOST.test(url.hostname)) return null
  if (!(artworkExtension(url) in ARTWORK_TYPES)) return null
  return url
}

export function artworkExtension(url: URL): string {
  if (BLOBSTORE_HOST.test(url.hostname)) return SNIFFED_EXTENSION
  return (url.pathname.split('.').pop() ?? '').toLowerCase()
}

/**
 * Önbellek anahtarı: süreli imzalı blobstore adresinde imza her senkronda değişir; anahtar imzasız
 * adres (origin + yol) olur, aynı kapak tekrar indirilmez. Diğerlerinde tam adres.
 */
export function artworkCacheKey(source: URL): string {
  return BLOBSTORE_HOST.test(source.hostname) ? source.origin + source.pathname : source.href
}

/** Önbellek dosya adı: `<sha256(anahtar) onaltılık>.<uzantı>` (özet her süreçte node:crypto ile). */
export function artworkFileName(source: URL, sha256Hex: string): string {
  return `${sha256Hex}.${artworkExtension(source)}`
}

/** Uzantısız kapağın türü ilk baytlardan: JPEG, PNG, WebP; tanınmazsa `null` (sunulmaz). */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)))
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}
