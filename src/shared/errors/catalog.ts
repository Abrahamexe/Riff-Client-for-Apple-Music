import type { MessageKey } from '../i18n'

// Hata kodu kataloğu (PLAN 1.3b) — TEK KAYNAK. Uygulamadaki her hata buradaki bir kodu taşır.
//  - `id`: sabit, DEĞİŞMEYEN kimlik (ör. AUTH_001). Log, tanılama paketi ve kullanıcıya gösterilen
//    mesaj aynı kimliği taşır. Yayınlanmış bir kimlik başka anlama verilmez, silinse de yeniden
//    kullanılmaz; yeni hata yeni numara alır.
//  - anahtar (ör. UNAUTHORIZED): koddaki okunabilir ad; süreç sınırlarında (`{ code }`) bu taşınır.
//  - `retryable`: aynı isteği bir süre sonra tekrar denemek mantıklı mı (withRetry buna bakar).
//  - `messageKey`: kullanıcı mesajı (shared/i18n). Teknik ayrıntı kullanıcıya değil loga gider.
//  - `logLevel`: logError'ın kullanacağı seviye.

export type ErrorCategory =
  | 'app'
  | 'ipc'
  | 'auth'
  | 'token'
  | 'net'
  | 'musickit'
  | 'playback'
  | 'drm'
  | 'worker'
  | 'db'
  | 'storage'
  | 'library'
  | 'window'
  | 'security'
  | 'background'

/** Kategori → kimlik öneki (`AUTH_001`). */
export const CATEGORY_PREFIX: Readonly<Record<ErrorCategory, string>> = {
  app: 'APP',
  ipc: 'IPC',
  auth: 'AUTH',
  token: 'TOKEN',
  net: 'NET',
  musickit: 'MK',
  playback: 'PLAY',
  drm: 'DRM',
  worker: 'WRK',
  db: 'DB',
  storage: 'STORE',
  library: 'LIB',
  window: 'WIN',
  security: 'SEC',
  background: 'BG'
}

export type LogLevel = 'error' | 'warn' | 'info'

export interface ErrorDefinition {
  id: string
  category: ErrorCategory
  retryable: boolean
  messageKey: MessageKey
  logLevel: LogLevel
}

const def = (
  id: string,
  category: ErrorCategory,
  messageKey: MessageKey,
  { retryable = false, logLevel = 'error' }: { retryable?: boolean; logLevel?: LogLevel } = {}
): ErrorDefinition => ({ id, category, retryable, messageKey, logLevel })

export const ERROR_CATALOG = {
  // --- Genel ---------------------------------------------------------------------------------
  UNKNOWN: def('APP_001', 'app', 'error.unknown'),
  INVALID_ARGUMENT: def('APP_002', 'app', 'error.invalidArgument', { logLevel: 'warn' }),
  /** Beklenmeyen iç hata; ayrıntısı yalnızca logda. */
  INTERNAL: def('APP_003', 'app', 'error.unknown'),
  /** Çökme döngüsü (PLAN 2.3): arka plan katmanı ve ön yükleme kapatıldı. */
  SAFE_MODE_ENABLED: def('APP_004', 'app', 'error.safeMode', { logLevel: 'warn' }),

  // --- IPC / süreç sınırı (Güvenlik kuralı 4) ------------------------------------------------
  UNKNOWN_CHANNEL: def('IPC_001', 'ipc', 'error.requestRejected', { logLevel: 'warn' }),
  FORBIDDEN: def('IPC_002', 'ipc', 'error.requestRejected', { logLevel: 'warn' }),
  INVALID_PAYLOAD: def('IPC_003', 'ipc', 'error.invalidArgument', { logLevel: 'warn' }),
  /** Kanal başına hız sınırı aşıldı (PLAN 2.4; istismar/döngü koruması). */
  IPC_RATE_LIMITED: def('IPC_004', 'ipc', 'error.requestRejected', { logLevel: 'warn' }),

  // --- Oturum --------------------------------------------------------------------------------
  /** 401/403: user token geçersiz → sil, yeniden giriş iste. */
  UNAUTHORIZED: def('AUTH_001', 'auth', 'error.unauthorized', { logLevel: 'warn' }),
  /** Giriş penceresi iptal/başarısız. */
  AUTHORIZATION_FAILED: def('AUTH_002', 'auth', 'error.authorizationFailed', { logLevel: 'info' }),
  /**
   * Apple giriş penceresi yüklenemedi (DNS, bağlantı, zaman aşımı). Geçici ağ hatasında pencere
   * kendisi bir kez yenilenir (auth-window.ts); withRetry kapsamında değildir.
   */
  AUTH_WINDOW_LOAD_FAILED: def('AUTH_003', 'auth', 'error.authorizationFailed', {
    logLevel: 'warn'
  }),
  /**
   * Worker'da kullanıcı token'ı yok (giriş yapılmamış veya çıkış yapıldı). UNAUTHORIZED'dan farklı:
   * geçerli bir oturumu silmeyi TETİKLEMEZ (2.7 D1).
   */
  NOT_SIGNED_IN: def('AUTH_004', 'auth', 'error.signInRequired', { logLevel: 'info' }),

  // --- Developer token -----------------------------------------------------------------------
  DEVELOPER_TOKEN_UNAVAILABLE: def('TOKEN_001', 'token', 'error.developerTokenUnavailable'),
  /** Yenile ve MusicKit.configure'ı tekrarla. */
  DEVELOPER_TOKEN_EXPIRED: def('TOKEN_002', 'token', 'error.developerTokenExpired', {
    logLevel: 'warn'
  }),
  /** Zorunlu .env alanı yok veya boş (yalnızca dev build). */
  TOKEN_ENV_MISSING: def('TOKEN_003', 'token', 'error.developerConfig'),
  /** .env alanı var ama biçimi hatalı. */
  TOKEN_ENV_INVALID: def('TOKEN_004', 'token', 'error.developerConfig'),
  /** .p8 anahtar dosyası okunamadı. */
  TOKEN_KEY_FILE_UNREADABLE: def('TOKEN_005', 'token', 'error.developerConfig'),
  /** Dosya geçerli bir PKCS#8 P-256 anahtarı değil. */
  TOKEN_KEY_INVALID: def('TOKEN_006', 'token', 'error.developerConfig'),
  TOKEN_SIGN_FAILED: def('TOKEN_007', 'token', 'error.developerTokenUnavailable'),
  /** Production build: dev sağlayıcı yok (RemoteTokenProvider Faz 4). */
  TOKEN_PROVIDER_UNAVAILABLE: def('TOKEN_008', 'token', 'error.tokenProviderUnavailable'),

  // --- Ağ / Apple Music API ------------------------------------------------------------------
  OFFLINE: def('NET_001', 'net', 'error.offline', { retryable: true, logLevel: 'warn' }),
  /** 429: geri çekil (backoff). */
  RATE_LIMITED: def('NET_002', 'net', 'error.rateLimited', { retryable: true, logLevel: 'warn' }),
  /** 5xx: geçici. */
  SERVER_ERROR: def('NET_003', 'net', 'error.serverError', { retryable: true, logLevel: 'warn' }),
  API_REQUEST_FAILED: def('NET_004', 'net', 'error.apiRequestFailed'),
  /** Apple yanıtı beklenen şemaya uymuyor (Güvenlik kuralı 6). */
  API_RESPONSE_INVALID: def('NET_005', 'net', 'error.apiRequestFailed', { logLevel: 'warn' }),
  /** Daha yeni bir istek geldiği için iptal edildi (ör. yazarken arama, 3.B1); hata değil. */
  REQUEST_CANCELLED: def('NET_006', 'net', 'error.requestCancelled', { logLevel: 'info' }),

  // --- MusicKit ------------------------------------------------------------------------------
  MUSICKIT_LOAD_FAILED: def('MK_001', 'musickit', 'error.musicKitUnavailable'),
  MUSICKIT_LOAD_TIMEOUT: def('MK_002', 'musickit', 'error.musicKitUnavailable'),
  MUSICKIT_CONFIGURE_FAILED: def('MK_003', 'musickit', 'error.musicKitUnavailable'),
  MUSICKIT_NOT_CONFIGURED: def('MK_004', 'musickit', 'error.musicKitUnavailable', {
    logLevel: 'warn'
  }),

  // --- Çalma / DRM ---------------------------------------------------------------------------
  PLAYBACK_FAILED: def('PLAY_001', 'playback', 'error.playbackFailed'),
  /** Player komutu iletilemedi: ana pencere (MusicKit) yok. */
  PLAYER_UNAVAILABLE: def('PLAY_002', 'playback', 'error.playerUnavailable', { logLevel: 'warn' }),
  /**
   * Komut geldi ama MusicKit player'ı veya Widevine CDM henüz hazır değil (PLAN 1.8c). Otomatik
   * yeniden denenmez: kullanıcının eski komutu geç çalışmasın.
   */
  PLAYER_NOT_READY: def('PLAY_003', 'playback', 'error.playerNotReady', { logLevel: 'warn' }),
  /**
   * Hesapta başka bir cihaz çalıyor (MusicKit STREAM_UPSELL / DEVICE_LIMIT; bireysel abonelikte tek
   * akış). Gözlem (2.3): MusicKit bazen birkaç saniye sonra akışı devralır; arayüz bunu "çalınamadı"
   * gibi göstermemeli.
   */
  PLAYBACK_STREAM_LIMIT: def('PLAY_004', 'playback', 'error.streamLimit', { logLevel: 'warn' }),
  /** Widevine CDM hâlâ hazırlanıyor (bekleme süresi doldu). */
  DRM_NOT_READY: def('DRM_001', 'drm', 'error.drmNotReady', { logLevel: 'warn' }),
  /** Widevine CDM kurulamadı. */
  DRM_UNAVAILABLE: def('DRM_002', 'drm', 'error.drmUnavailable'),

  // --- Worker / yerel veri -------------------------------------------------------------------
  /** Arka plan süreci (worker) yanıt vermiyor. */
  WORKER_UNAVAILABLE: def('WRK_001', 'worker', 'error.workerUnavailable'),
  DB_OPEN_FAILED: def('DB_001', 'db', 'error.databaseFailed'),
  /** DB şeması uygulamanınkinden yeni (uygulama geri alınmış). */
  DB_SCHEMA_TOO_NEW: def('DB_002', 'db', 'error.databaseFailed'),
  /**
   * DB bozuk / açılamadı / şeması yeni (PLAN 2.3): DB bir önbellek olduğu için silinip yeniden
   * kuruldu; veri Apple'dan yeniden yüklenir.
   */
  DB_RECREATED: def('DB_003', 'db', 'error.databaseFailed', { logLevel: 'warn' }),
  PLAYLIST_NOT_FOUND: def('LIB_001', 'library', 'error.playlistNotFound', { logLevel: 'warn' }),
  /**
   * Kütüphane yazma işlemi (3.B2) Apple'da başarısız oldu veya kuyrukta çok kez denendi; yerel
   * (iyimser) değişiklik geri alındı.
   */
  LIBRARY_WRITE_FAILED: def('LIB_002', 'library', 'error.libraryWriteFailed', { logLevel: 'warn' }),
  /** Albüm/sanatçı/playlist bulunamadı (404; kullanıcının mağazasında olmayabilir). */
  CONTENT_NOT_FOUND: def('LIB_003', 'library', 'error.contentNotFound', { logLevel: 'info' }),
  /**
   * Sayfalı liste güvenlik sınırına ulaştı (PLAN_v5 A4: 2.000 sayfa × 100 = 200.000 öğe); kalan
   * öğeler alınmadı. Sessizce eksik kalmaz: uyarı loglanır.
   */
  LIBRARY_TRUNCATED: def('LIB_004', 'library', 'error.libraryTruncated', { logLevel: 'warn' }),

  // --- Pencere / renderer (PLAN 2.3) ----------------------------------------------------------
  /** Ana pencerenin renderer süreci çöktü; pencere yeniden yükleniyor. */
  RENDERER_CRASHED: def('WIN_001', 'window', 'error.appRecovering'),

  // --- Güvenli depo (safeStorage) ------------------------------------------------------------
  STORE_ENCRYPTION_UNAVAILABLE: def('STORE_001', 'storage', 'error.secureStorageUnavailable'),
  STORE_INVALID_VALUE: def('STORE_002', 'storage', 'error.invalidArgument', { logLevel: 'warn' }),
  /** Kayıtlı dosya çözülemedi (bozuk / başka kullanıcıdan); silinir, yeniden giriş gerekir. */
  STORE_CORRUPTED: def('STORE_003', 'storage', 'error.unauthorized', { logLevel: 'warn' }),

  // --- Güvenlik politikası engellemeleri (Güvenlik kuralı 7; yalnızca log) --------------------
  NAVIGATION_BLOCKED: def('SEC_001', 'security', 'error.requestRejected', { logLevel: 'warn' }),
  POPUP_BLOCKED: def('SEC_002', 'security', 'error.requestRejected', { logLevel: 'warn' }),
  WEBVIEW_BLOCKED: def('SEC_003', 'security', 'error.requestRejected', { logLevel: 'warn' }),
  PERMISSION_DENIED: def('SEC_004', 'security', 'error.requestRejected', { logLevel: 'warn' }),
  /** P8: tarayıcı indirmesi reddedildi (uygulama indirme kullanmaz). */
  DOWNLOAD_BLOCKED: def('SEC_005', 'security', 'error.requestRejected', { logLevel: 'warn' }),

  // --- Müzik arka planı katmanı (PLAN 3.A; MusicBrainz, Wikidata/Wikipedia; BG_005 kaldırıldı) ---
  /** Kaynak hız sınırı yanıtı (429; MusicBrainz için 503): kaynak duraklatılır, geri çekilinir. */
  BG_RATE_LIMITED: def('BG_001', 'background', 'error.backgroundBusy', {
    retryable: true,
    logLevel: 'warn'
  }),
  /** Kaynağa ulaşılamadı (ağ yok, zaman aşımı, 5xx). Cache varsa ondan dönülür. */
  BG_SOURCE_UNAVAILABLE: def('BG_002', 'background', 'error.backgroundUnavailable', {
    retryable: true,
    logLevel: 'warn'
  }),
  /** Kaynak yanıtı beklenen şemaya uymuyor (Güvenlik kuralı 6). */
  BG_RESPONSE_INVALID: def('BG_003', 'background', 'error.backgroundUnavailable', {
    logLevel: 'warn'
  }),
  /** Kaynak isteği reddetti (4xx; 404 hata sayılmaz, "bulunamadı" olarak döner). */
  BG_REQUEST_FAILED: def('BG_004', 'background', 'error.backgroundUnavailable', {
    logLevel: 'warn'
  }),
  /** Şarkı kaynaklarda güvenilir biçimde eşleştirilemedi. */
  BG_NO_MATCH: def('BG_006', 'background', 'error.backgroundNoMatch', { logLevel: 'info' }),
  /** İstek izin listesinde olmayan bir host'a gidecekti (yalnızca https + kaynak host'ları). */
  BG_HOST_NOT_ALLOWED: def('BG_007', 'background', 'error.requestRejected', { logLevel: 'warn' }),
  /** İstek iptal edildi (çalan şarkı değişti); hata değil. Başlamamış istek hız kotası harcamaz. */
  BG_CANCELLED: def('BG_008', 'background', 'error.backgroundCancelled', { logLevel: 'info' })
} as const satisfies Record<string, ErrorDefinition>

export type ErrorCode = keyof typeof ERROR_CATALOG

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[]

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code)
}
