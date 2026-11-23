import type { ExternalLink } from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'

// Uygulama dışında (varsayılan tarayıcıda) açılan bağlantılar (PLAN_v5 P4; Güvenlik kuralı 7:
// `shell.openExternal` yalnızca doğrulanmış `https:` URL). Renderer URL göndermez, yalnızca bu
// tablodaki bir ANAHTAR gönderir; adres main'de sabittir. Her adres gerekçesiyle ve resmi kaynaktan:
//  - manageSubscriptions: Apple Destek "Cancel a subscription from Apple" (support.apple.com/118428,
//    2026-10-13) web yolu olarak bu adresi verir (abonelik görüntüleme / iptal; Apple Hesabı girişi
//    Apple'ın sayfasında yapılır, uygulama kimlik bilgisi görmez).

export const EXTERNAL_LINK_URLS: Readonly<Record<ExternalLink, string>> = {
  manageSubscriptions: 'https://account.apple.com/account/manage/section/subscriptions'
}

/** Açılmasına izin verilen host'lar (tablodaki her adres bunlardan birinde olmak zorunda). */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['account.apple.com'])

/** Kaynak bağlantısı host'ları (sözleşmedeki `SOURCE_LINK` kalıbıyla aynı küme). */
const SOURCE_HOSTS: ReadonlySet<string> = new Set([
  'tr.wikipedia.org',
  'en.wikipedia.org',
  'www.wikipedia.org',
  'www.wikidata.org',
  'musicbrainz.org',
  'creativecommons.org',
  'lrclib.net'
])

/** Kaynak bağlantısını ikinci kez doğrular: https, izinli host, kullanıcı bilgisi / port / parça yok. */
export function sourceLinkUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CoreError('FORBIDDEN', 'Kaynak bağlantısı geçersiz.')
  }
  if (
    url.protocol !== 'https:' ||
    !SOURCE_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search
  ) {
    throw new CoreError('FORBIDDEN', 'Kaynak bağlantısı izin listesinde değil.')
  }
  return url.href
}

/** Anahtarın adresini doğrular: yalnızca https, izinli host, kullanıcı bilgisi/port yok. */
export function externalLinkUrl(link: ExternalLink): string {
  const raw = EXTERNAL_LINK_URLS[link]
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CoreError('FORBIDDEN', `Dış bağlantı geçersiz: ${link}`)
  }
  if (
    url.protocol !== 'https:' ||
    !ALLOWED_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new CoreError('FORBIDDEN', `Dış bağlantı izin listesinde değil: ${link}`)
  }
  return url.href
}
