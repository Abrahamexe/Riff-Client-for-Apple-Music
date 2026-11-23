import type { I18n, MessageParams } from '../i18n'
import { ERROR_CATALOG, isErrorCode, type ErrorCode, type LogLevel } from './catalog'

// Tüm servisler aynı hata tipini döner (PLAN 1.9, 1.3b). MusicKit, ağ ve kendi hatalarımız burada
// tek bir `CoreError`'a normalize edilir; her CoreError katalogdaki bir kodu taşır
// (shared/errors/catalog.ts). `message` TEKNİK açıklamadır (log); kullanıcıya gösterilen metin
// `userMessage()` ile katalogdaki i18n anahtarından üretilir. Renderer, main ve worker ortak kullanır;
// DOM'a veya Node'a bağımlı değildir.

export * from './catalog'

/** Eski ad; yeni kodda `ErrorCode` kullanın. */
export type CoreErrorCode = ErrorCode

export interface CoreErrorOptions {
  cause?: unknown
  status?: number
  /** Sunucunun istediği bekleme süresi (Retry-After), ms. */
  retryAfterMs?: number
  /**
   * Kullanıcı mesajındaki yer tutucular (ör. `{fields}`). Kişisel veri veya token İÇERMEZ:
   * süreç sınırlarını geçer ve loglanabilir.
   */
  params?: MessageParams
}

export class CoreError extends Error {
  readonly status?: number
  readonly retryAfterMs?: number
  readonly params?: MessageParams

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: CoreErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CoreError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.params = options.params
  }

  /** Katalogdaki sabit kimlik (ör. AUTH_001). */
  get id(): string {
    return ERROR_CATALOG[this.code].id
  }

  /** Aynı isteği bir süre sonra tekrar denemek mantıklı mı? */
  get retryable(): boolean {
    return ERROR_CATALOG[this.code].retryable
  }

  get logLevel(): LogLevel {
    return ERROR_CATALOG[this.code].logLevel
  }

  /** Süreç sınırından (IPC / MessagePort) geçen biçim. */
  toWire(): WireError {
    return {
      code: this.code,
      message: this.message,
      ...(this.params ? { params: this.params } : {})
    }
  }
}

/** Süreç sınırlarındaki hata zarfı (IpcResult.error). */
export interface WireError {
  code: string
  /** Teknik açıklama (loglar için); kullanıcıya gösterilmez. */
  message: string
  params?: MessageParams
}

/** Kullanıcıya gösterilecek, etkin dildeki mesaj. Teknik ayrıntı içermez. */
export function userMessage(error: CoreError, i18n: I18n): string {
  return i18n.format(ERROR_CATALOG[error.code].messageKey, error.params)
}

/** Kullanıcı mesajı + hata kimliği (ör. "… (hata kodu: NET_001)"); destek/tanılama için. */
export function userMessageWithId(error: CoreError, i18n: I18n): string {
  return i18n.t('error.withCode', { message: userMessage(error, i18n), id: error.id })
}

// MusicKit'in MKError.errorCode değerleri (musickit.js v3'ten) ve HTTP durumları → ErrorCode.
const MK_REASON_TO_CODE: Readonly<Record<string, ErrorCode>> = {
  UNAUTHORIZED_ERROR: 'UNAUTHORIZED',
  ACCESS_DENIED: 'UNAUTHORIZED',
  AUTHORIZATION_ERROR: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'DEVELOPER_TOKEN_EXPIRED',
  QUOTA_EXCEEDED: 'RATE_LIMITED',
  NETWORK_ERROR: 'OFFLINE',
  SERVER_ERROR: 'SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVER_ERROR'
}

export function codeFromStatus(status: number): ErrorCode | null {
  if (status === 401 || status === 403) return 'UNAUTHORIZED'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return null
}

function readStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; data?: { status?: unknown } } | null
  const status = e?.data?.status ?? e?.status
  return typeof status === 'number' ? status : undefined
}

/**
 * Herhangi bir hatayı CoreError'a çevirir. Zaten CoreError ise aynen döner.
 * `navigator.onLine === false` veya fetch'in "Failed to fetch" TypeError'ı → OFFLINE.
 */
export function toCoreError(
  err: unknown,
  fallback: ErrorCode = 'API_REQUEST_FAILED',
  message = 'İstek başarısız oldu.'
): CoreError {
  if (err instanceof CoreError) return err

  const status = readStatus(err)
  const reason = (err as { errorCode?: unknown } | null)?.errorCode
  const byReason = typeof reason === 'string' ? MK_REASON_TO_CODE[reason] : undefined
  const byStatus = status !== undefined ? codeFromStatus(status) : null
  const offline =
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    (err instanceof TypeError && /failed to fetch|network/i.test(err.message))

  const code = byReason ?? byStatus ?? (offline ? 'OFFLINE' : fallback)
  return new CoreError(code, message, { cause: err, status })
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof CoreError && err.code === 'UNAUTHORIZED'
}

/**
 * Süreç sınırından (IPC / MessagePort) gelen hatayı CoreError'a çevirir. Kod katalogda yoksa
 * (eski/bozuk karşı taraf) UNKNOWN; kod ve parametreler korunur ki log ve kullanıcı mesajı aynı
 * kimliği taşısın.
 */
export function fromWireError(error: WireError): CoreError {
  const params = error.params
  return new CoreError(isErrorCode(error.code) ? error.code : 'UNKNOWN', error.message, {
    ...(params ? { params } : {})
  })
}

/** Log satırı: `[kapsam] KİMLİK KOD: teknik mesaj (HTTP durum)`. */
function describeError(scope: string, error: CoreError): string {
  const status = error.status !== undefined ? ` (HTTP ${error.status})` : ''
  return `[${scope}] ${error.id} ${error.code}: ${error.message}${status}`
}

/**
 * Hatayı katalogdaki seviyede loglar ve normalize edilmiş CoreError'ı döner. CoreError olmayan
 * hatalar `fallback` koduna çevrilir; orijinal hata (yığın için) ayrı argüman olarak yazılır.
 * Token veya kişisel veri içerebilecek değerleri buraya VERMEYİN (Güvenlik kuralı 10).
 */
export function logError(
  scope: string,
  err: unknown,
  fallback: ErrorCode = 'UNKNOWN',
  message = 'Beklenmeyen bir hata oluştu.'
): CoreError {
  const error = toCoreError(err, fallback, message)
  const line = describeError(scope, error)
  const extra = err instanceof CoreError ? error.cause : err
  if (extra === undefined) console[error.logLevel](line)
  else console[error.logLevel](line, extra)
  return error
}
