import { CoreError } from './errors'

// Uygulama yapılandırması (geliştiricinin belirlediği sabitler). Gizli bilgi İÇERMEZ: renderer'a da
// girebilir. Key/token gibi değerler burada değil, dev build'de .env'de durur (CLAUDE.md kural 1).

export const APP_CONFIG = {
  /** Dış kaynaklara gönderilen User-Agent'taki uygulama adı (boşluksuz). */
  userAgentName: 'RiffClient',
  /**
   * Dış kaynakların (MusicBrainz, Wikimedia, LRCLIB) uygulama bakımcısına ulaşabileceği
   * iletişim bilgisi: https URL'si veya e-posta. MusicBrainz ve Wikimedia User-Agent politikaları
   * bunu zorunlu tutar (PLAN 3.A1). Geliştirici belirler.
   */
  contact: 'https://github.com/Abrahamexe',
  /**
   * Müzik arka planı cache'i (PLAN 3.A8): yerel DB'de tutulan dış kaynak yanıtları, eşleşmeler ve
   * birleşik sonuçların toplam veri boyutu. Gerekçe ve ölçüm: docs/PERFORMANCE.md.
   */
  /** Kapak görseli disk önbelleği (PLAN 2.2): toplam dosya boyutu sınırı, LRU. */
  artworkCache: {
    maxBytes: 100 * 1024 * 1024,
    lowWaterRatio: 0.9,
    sweepEveryWrites: 100
  },
  backgroundCache: {
    /** Toplam üst sınır (bayt): anahtar + saklanan JSON. Aşılırsa en az kullanılanlar silinir. */
    // 2.2: 64 → 256 MiB (≈ 2.150–4.470 şarkı; geliştirici onayı 2026-10-12).
    maxBytes: 256 * 1024 * 1024,
    /** Sınır aşılınca bu orana kadar küçültülür (her yazmada sınırda dönmemek için). */
    lowWaterRatio: 0.9,
    /** Açılıştaki temizliğe ek olarak bu kadar cache yazımından sonra temizlik çalışır. */
    sweepEveryWrites: 50
  }
} as const

/**
 * Çalma bağlantısını ısıtma (2026-10-14): tıklama → ses yolundaki Apple çalma sunucuları. Main bu
 * origin'lere (ve yalnızca bunlara) ön bağlantı açar; renderer adres gönderemez. CSP `connect-src`'de var.
 */
export const PLAYBACK_WARMUP_ORIGINS = [
  'https://play.itunes.apple.com',
  'https://aod-ssl.itunes.apple.com'
] as const

/**
 * Hızlı DNS (2026-10-15, R2; İnce Ayar `tweaks.fastDns`, varsayılan açık). Ölçüm: geliştiricinin sistem
 * DNS'i alan adı başına 4–10 sn → açılışta oturum 21 sn; Cloudflare 25–60 ms → 3,9 sn. Chromium
 * (MusicKit, çalma) DNS-over-HTTPS kullanır; şablonlar IP'li, çünkü ad olsaydı DoH sunucusunun kendisi
 * yavaş sistem DNS'iyle çözülürdü. Worker (Node) aynı sunuculara düz DNS sorar ve sistemle yarıştırır.
 * Cloudflare yalnızca alan adlarını görür (gizlilik: docs/PRIVACY.md).
 */
export const FAST_DNS = {
  dohTemplates: ['https://1.1.1.1/dns-query', 'https://1.0.0.1/dns-query'],
  servers: ['1.1.1.1', '1.0.0.1']
} as const

/** İletişim bilgisi geçerli mi? (https URL'si veya e-posta) */
function isValidContact(contact: string): boolean {
  if (/^[^\s@()]+@[^\s@()]+\.[^\s@()]+$/.test(contact)) return true
  try {
    const url = new URL(contact)
    return url.protocol === 'https:' && !/[\s()]/.test(contact)
  } catch {
    return false
  }
}

/**
 * Tanımlayıcı User-Agent: `RiffClient/<sürüm> ( <iletişim> )`. Biçim MusicBrainz'in önerdiği
 * `Application name/<version> ( contact-url )` biçimidir; Wikimedia politikasının istediği ad, sürüm
 * ve iletişim bilgisini de içerir. İletişim bilgisi geçersizse hata (anonim UA ile istek atılmaz).
 */
export function buildUserAgent(
  version: string,
  { userAgentName, contact }: { userAgentName: string; contact: string } = APP_CONFIG
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(userAgentName) || !/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new CoreError('INVALID_ARGUMENT', 'User-Agent adı veya sürümü geçersiz.')
  }
  if (!isValidContact(contact))
    throw new CoreError('INVALID_ARGUMENT', 'User-Agent iletişim bilgisi geçersiz.')
  return `${userAgentName}/${version} ( ${contact} )`
}
