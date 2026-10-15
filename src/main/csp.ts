// Renderer Content-Security-Policy'si (Güvenlik kuralı 8). Build sırasında index.html'e yazılır
// (electron.vite.config.ts). Yeni domain yalnızca gerekçesiyle eklenir.

// Apple domain'leri MusicKit script'inin kendisinden çıkarıldı (js-cdn.music.apple.com/musickit/v3).
// Çalma/artwork/ses CDN'leri 1.5–1.6'da konsoldaki CSP ihlallerinden tespit edilip eklenecek
// (debug paneli `securitypolicyviolation` olaylarını loglar).
const APPLE_CONNECT = [
  'https://api.music.apple.com',
  'https://authorize.music.apple.com',
  'https://play.itunes.apple.com',
  'https://play-edge.itunes.apple.com',
  'https://js-cdn.music.apple.com',
  // V4 (2026-10-12) gözlem: tam şarkının HLS manifesti/segmentleri ("Could not fetch manifest").
  'https://aod-ssl.itunes.apple.com',
  // V4 gözlem: MusicKit'in çalma etkinliği bildirimi (Apple hesabındaki "son çalınanlar"/dinleme
  // geçmişi). Veri kullanıcının kendi Apple hesabına gider; resmi istemcilerle aynı (PRIVACY.md).
  'https://universal-activity-service.itunes.apple.com'
]

/** `devServer`: yalnızca `electron-vite dev` (Vite HMR websocket'i için ws://localhost). */
export function buildCsp(devServer: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self' https://js-cdn.music.apple.com",
    // Inline stil yok: stiller styles.css'te. MusicKit stil enjekte etmeye çalışırsa panelde
    // CSP ihlali olarak görünür ve gerekçesiyle değerlendirilir.
    "style-src 'self'",
    // app://renderer: kapak önbelleği (2.2, /__art); dev server'da 'self' localhost olduğu için açıkça.
    "img-src 'self' app://renderer data: blob: https://*.mzstatic.com",
    "media-src 'self' blob:",
    `connect-src 'self' ${APPLE_CONNECT.join(' ')}${devServer ? ' ws://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
