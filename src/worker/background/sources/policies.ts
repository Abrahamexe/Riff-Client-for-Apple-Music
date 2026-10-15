// Kaynak politikaları (PLAN 3.A1). Limitler ve kurallar her kaynağın resmi dokümanından doğrulandı
// (2026-10-01); değerler belgelenen sınırın ALTINDA seçildi. Kaynak değiştirirse burası güncellenir.
//
// MusicBrainz — https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
//   "Currently that rate is (on average) 1 request per second" (IP başına); aşılırsa TÜM istekler
//   503 ile reddedilir. User-Agent zorunlu: "Application name/<version> ( contact-url )".
//   Çekirdek veri CC0 (https://musicbrainz.org/doc/About/Data_License).
// Wikidata / Wikipedia — https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
//   Uyumlu User-Agent'lı kimliksiz istemci: 200 istek/dk; limit tüm Wikimedia sitelerinde ortaktır
//   (tek sınırlayıcı paylaşılır); 429 + Retry-After. API:Etiquette: istekler paralel değil SIRAYLA.
//   User-Agent politikası: ad/sürüm + iletişim bilgisi, yoksa 403. Wikipedia metni CC BY-SA 4.0,
//   Wikidata verisi CC0.
// LRCLIB (şarkı sözleri, B11b) — https://lrclib.net/docs (2026-10-14)
//   Anahtarsız, ücretsiz. Tanımlayıcı User-Agent (ad, sürüm, bağlantı) zorunlu. 429 + Retry-After'a
//   uyulmazsa geçici yasak; 503 ServerOverloaded da Retry-After verir (genelde 1 sn). İstekler
//   sıralı ve aralarında 200–500 ms olmalı.

export type BackgroundSourceId = 'musicbrainz' | 'wikimedia' | 'lrclib'

export interface SourcePolicy {
  origins: readonly string[]
  /** Saniyede en fazla istek (ortalama). */
  perSecond: number
  burst: number
  maxConcurrent: number
  ttlMs: number
  notFoundTtlMs: number
  /** Kaynağa ulaşılamazken kullanılabilecek en eski cache. */
  /** Bu süreden eski cache satırı artık kullanılmaz ve temizlikte silinir (PLAN 3.A8). */
  retainMs: number
  treat503AsRateLimit: boolean
  rateLimitPauseMs: number
  docs: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const SOURCE_POLICIES: Readonly<Record<BackgroundSourceId, SourcePolicy>> = {
  musicbrainz: {
    origins: ['https://musicbrainz.org'],
    // Belgelenen: ortalama 1/sn. Seçilen: 0,85/sn (≈1,18 sn aralık), burst 1. V8 gözlemi: tam 1/sn'de
    // ağ gecikmesi dalgalanması istekleri sunucuya 1 sn'den yakın ulaştırıp 503 aldırdı.
    perSecond: 0.85,
    burst: 1,
    maxConcurrent: 1,
    ttlMs: 14 * DAY,
    notFoundTtlMs: DAY,
    // TTL'in 4 katı: çevrimdışı yedek olarak yeter, sonsuza kadar birikmez.
    retainMs: 56 * DAY,
    // MusicBrainz limit aşımında 503 döner.
    treat503AsRateLimit: true,
    rateLimitPauseMs: 5_000,
    docs: 'https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting'
  },
  wikimedia: {
    // Wikipedia özeti yalnızca uygulamanın dillerinde (tr, en) istenir.
    origins: ['https://www.wikidata.org', 'https://tr.wikipedia.org', 'https://en.wikipedia.org'],
    // Belgelenen: 200/dk (≈3,3/sn). Seçilen: 1/sn, sıralı (API:Etiquette).
    perSecond: 1,
    burst: 1,
    maxConcurrent: 1,
    ttlMs: 7 * DAY,
    notFoundTtlMs: DAY,
    retainMs: 28 * DAY,
    treat503AsRateLimit: false,
    rateLimitPauseMs: 10_000,
    docs: 'https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits'
  },
  lrclib: {
    origins: ['https://lrclib.net'],
    // Belgelenen: sıralı, aralarında 200–500 ms. Seçilen: 2,5/sn (≈400 ms aralık), sıralı.
    perSecond: 2.5,
    burst: 1,
    maxConcurrent: 1,
    // Sözler nadiren değişir. "Bulunamadı" kısa tutulur: LRCLIB eksik şarkıyı arka planda arayıp
    // sonradan ekleyebiliyor.
    ttlMs: 30 * DAY,
    notFoundTtlMs: DAY,
    retainMs: 60 * DAY,
    // 503 ServerOverloaded Retry-After ile döner: hız sınırı gibi kaynak geneli beklenir.
    treat503AsRateLimit: true,
    rateLimitPauseMs: 1_000,
    docs: 'https://lrclib.net/docs'
  }
}

export const BACKGROUND_SOURCE_IDS = Object.keys(SOURCE_POLICIES) as BackgroundSourceId[]
