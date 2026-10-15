// Bildirimler (§3.4, geliştirici kararı 2026-10-14): internet yokken arama çubuğunun altında kalıcı
// kapsül; hatalar alttaki kısa bildirimle (6 sn), gerekirse tek düğmeyle ("Yeniden Giriş Yap").
// Saf karar mantığı (testli): hangi oynatıcı hatası kullanıcıya gösterilir, aynı hata art arda
// tekrarlanmaz. Metin her zaman hata kataloğunun kullanıcı mesajıdır (`userMessage`).

/** Kullanıcıya bildirilmeyen kodlar: iptal / geçersiz istek (kullanıcı başka şey seçti), ayrıca
 *  gösterilenler (oturum → düğmeli bildirim, çevrimdışı → kalıcı kapsül). */
const SILENT: ReadonlySet<string> = new Set([
  'REQUEST_CANCELLED',
  'BG_CANCELLED',
  'INVALID_ARGUMENT',
  'UNAUTHORIZED',
  'OFFLINE'
])

/** Aynı kod bu süre içinde yeniden gösterilmez (ör. bir şarkının birkaç kez denenmesi). */
export const REPEAT_WINDOW_MS = 5_000

export function createErrorNoticeFilter(now: () => number = () => performance.now()) {
  const last = new Map<string, number>()
  return (code: string): boolean => {
    if (SILENT.has(code)) return false
    const t = now()
    const prev = last.get(code)
    if (prev !== undefined && t - prev < REPEAT_WINDOW_MS) return false
    last.set(code, t)
    return true
  }
}

/** Çevrimiçi durum geçişi: yalnızca çevrimdışından dönüşte "geri geldi" bildirilir. */
export function onlineTransition(prev: boolean, next: boolean): 'lost' | 'restored' | null {
  if (prev === next) return null
  return next ? 'restored' : 'lost'
}
