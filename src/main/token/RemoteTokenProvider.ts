import { decodeJwt, decodeProtectedHeader } from 'jose'
import { z } from 'zod/mini'
import { codeFromStatus, CoreError } from '@shared/errors'
import { withRetry, type RetryOptions } from '@shared/retry'
import { TokenError, type TokenProvider } from './TokenProvider'

// Production developer token sağlayıcısı (PLAN 4.1). Token, `.p8`'i yalnızca sunucuda tutan servisten
// (server/token-service) alınır; istemcide anahtar yoktur. Kurallar:
//  - yalnızca https; yanıt şemayla doğrulanır (JWT biçimi, ES256, `exp` = `expiresAt`, gelecekte)
//  - önbellek + süresi dolmadan `REFRESH_MARGIN_SECONDS` önce yenileme; eşzamanlı çağrılar tek istek
//  - geçici hata (ağ, 429, 5xx) withRetry ile; 429'da Retry-After'a uyulur
//  - token loglanmaz; hata mesajları URL sorgusu/token içermez
// Ağ isteği main'dedir: saatlerce bir kez yapılan küçük bir istek (DevTokenProvider'ın imzalaması da
// main'de); ağır iş değildir.

export const REFRESH_MARGIN_SECONDS = 10 * 60
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TOKEN_LENGTH = 4_096

const ResponseSchema = z.object({
  token: z
    .string()
    .check(
      z.maxLength(MAX_TOKEN_LENGTH),
      z.regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    ),
  expiresAt: z.number().check(z.int())
})

export interface RemoteTokenProviderOptions {
  url: string
  appVersion: string
  fetch?: typeof fetch
  /** Unix saniyesi */
  now?: () => number
  retry?: RetryOptions
  timeoutMs?: number
}

export class RemoteTokenProvider implements TokenProvider {
  private readonly url: URL
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private cached: { token: string; exp: number } | null = null
  private inFlight: Promise<{ token: string; exp: number }> | null = null

  constructor(private readonly options: RemoteTokenProviderOptions) {
    let url: URL
    try {
      url = new URL(options.url)
    } catch {
      throw new TokenError('TOKEN_PROVIDER_UNAVAILABLE', 'Token servisi adresi geçersiz.')
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new TokenError('TOKEN_PROVIDER_UNAVAILABLE', 'Token servisi yalnızca https olabilir.')
    }
    this.url = url
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
  }

  async getDeveloperToken(): Promise<string> {
    const cached = this.cached
    if (cached && cached.exp - this.now() > REFRESH_MARGIN_SECONDS) return cached.token
    this.inFlight ??= withRetry(() => this.fetchOnce(), this.options.retry).finally(() => {
      this.inFlight = null
    })
    const fresh = await this.inFlight
    this.cached = fresh
    return fresh.token
  }

  invalidate(): void {
    this.cached = null
  }

  private async fetchOnce(): Promise<{ token: string; exp: number }> {
    let res: Response
    try {
      res = await this.fetchImpl(this.url, {
        // P8 (F3): token servisi yönlendirmez; 3xx izlenmez, hata olarak döner.
        redirect: 'manual',
        headers: { accept: 'application/json', 'x-am-client': this.options.appVersion },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      })
    } catch (cause) {
      throw new CoreError('OFFLINE', 'Token servisine ulaşılamadı.', { cause })
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'))
      throw new CoreError(
        codeFromStatus(res.status) ?? 'DEVELOPER_TOKEN_UNAVAILABLE',
        `Token servisi hatası (HTTP ${res.status}).`,
        {
          status: res.status,
          ...(Number.isFinite(retryAfter) && retryAfter > 0
            ? { retryAfterMs: retryAfter * 1000 }
            : {})
        }
      )
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw invalid('yanıt JSON değil')
    }
    const parsed = ResponseSchema.safeParse(body)
    if (!parsed.success) throw invalid('yanıt biçimi hatalı')
    const { token, expiresAt } = parsed.data
    try {
      const header = decodeProtectedHeader(token)
      const payload = decodeJwt(token)
      if (header.alg !== 'ES256' || payload.exp !== expiresAt) throw new Error('uyumsuz')
    } catch {
      throw invalid('token Apple biçiminde değil')
    }
    if (expiresAt - this.now() <= 60) throw invalid('token süresi dolmuş')
    return { token, exp: expiresAt }
  }
}

const invalid = (why: string): CoreError =>
  new CoreError('DEVELOPER_TOKEN_UNAVAILABLE', `Token servisi: ${why}.`)
