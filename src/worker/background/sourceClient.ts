import type { z } from 'zod/mini'
import { CoreError, logError } from '@shared/errors'
import { withRetry, type RetryOptions } from '@shared/retry'
import { parseRetryAfter } from '../net/appleApi'
import { readLimited } from '../net/readLimited'
import { abortableSleep, abortReason, throwIfCancelled } from './abort'
import type { ResponseCache } from './cache'
import type { Priority, RateLimiter } from './rateLimiter'

// Dış kaynak HTTP istemcisi (PLAN 3.A1). Her kaynak (MusicBrainz, Wikimedia, LRCLIB) kendi
// örneğini ve kendi hız sınırlayıcısını kullanır. Her istek sırayla:
//  1. cache: kaynağın TTL'i içindeyse ağa çıkılmaz;
//  2. izin listesi: yalnızca https ve kaynağın kendi host'ları (BG_HOST_NOT_ALLOWED);
//  3. hız sınırlayıcı (öncelikli), tanımlayıcı User-Agent, zaman aşımı;
//  4. 429/503 → kaynak geneli duraklatma + üstel geri çekilme (Retry-After'a uyulur); 5xx/ağ → tekrar;
//  5. yanıt zod şemasından geçer, cache'e yazılır; 404 "bulunamadı" (`null`) olarak cache'lenir.
// Yönlendirmeler elle izlenir (A3.3): her `Location` istek ATILMADAN izin listesiyle denetlenir, en
// fazla `MAX_REDIRECTS` adım. Gövde akışla en fazla
// `MAX_BODY_BYTES` okunur.
// Ağ yoksa veya kaynak yanıt vermiyorsa eski cache döner (çevrimdışı okuma).
// İptal (PLAN 3.A8): `signal` iptal edilirse çağıran hemen `BG_CANCELLED` alır. Aynı adrese eşzamanlı
// istekler tek ağ isteğini paylaşır; ağ isteği YALNIZCA tüm bekleyenler iptal edince kesilir (bir
// çağıranın iptali diğerinin sonucunu bozmaz). Sırada bekleyen istek hız kotası harcamaz (rateLimiter.ts).
// Loglara URL/sorgu YAZILMAZ (dinlenen şarkı kişisel veridir): yalnızca
// kaynak adı ve HTTP durumu.

export interface SourceClientOptions {
  /** Kaynak kimliği (log, cache). */
  source: string
  /** İzin verilen origin'ler, ör. `https://musicbrainz.org`. */
  origins: readonly string[]
  limiter: RateLimiter
  userAgent: string
  headers?: Readonly<Record<string, string>>
  /** Bu süreden yeni cache ağa çıkmadan döner. */
  ttlMs: number
  /** "Bulunamadı" (404) sonucunun tazelik süresi; varsayılan `ttlMs`. */
  notFoundTtlMs?: number
  /** 429/503 Retry-After vermezse kaynağın duraklatılacağı süre. */
  rateLimitPauseMs?: number
  /** 503'ü hız sınırı say (MusicBrainz limit aşımında 503 döner). */
  treat503AsRateLimit?: boolean
  /** 200 yanıtın gövdesindeki kaynak hatası (Wikidata `maxlag`). */
  inspectBody?: (body: unknown) => CoreError | null
  timeoutMs?: number
  retry?: RetryOptions
  cache?: ResponseCache
  fetch?: typeof fetch
  now?: () => number
}

export interface SourceResult<T> {
  /** 404 ise `null`. */
  data: T | null
  fetchedAt: number
  fromCache: boolean
  /** Cache TTL'i geçmiş ama kaynağa ulaşılamadığı için kullanıldı. */
  stale: boolean
}

export interface RequestOptions {
  priority?: Priority
  /** İptal sinyali (çalan şarkı değişince kullanıcı istekleri iptal edilir). */
  signal?: AbortSignal
}

interface InFlight {
  promise: Promise<SourceResult<unknown>>
  /** Ağ isteğinin sinyali: tüm bekleyenler iptal edince tetiklenir. */
  controller: AbortController
  /** İptal edilemeyen (sinyalsiz) bekleyenler dahil, sonucu bekleyen çağıran sayısı. */
  waiters: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RATE_LIMIT_PAUSE_MS = 5_000
const DEFAULT_RETRY: RetryOptions = { retries: 2, baseDelayMs: 1_000, maxDelayMs: 30_000 }
const MAX_REDIRECTS = 3
/** Kaynak yanıtları küçüktür (özet, ilişkiler); bu sınır bozuk/kötü niyetli dev gövdeye karşı. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export class SourceClient {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly inFlight = new Map<string, InFlight>()

  constructor(private readonly options: SourceClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  get source(): string {
    return this.options.source
  }

  /** `url`'deki JSON'u şemayla doğrulayarak döner (cache → ağ → eski cache). */
  async getJson<T>(
    url: URL,
    schema: z.ZodMiniType<T>,
    { priority = 'user', signal }: RequestOptions = {}
  ): Promise<SourceResult<T>> {
    throwIfCancelled(signal)
    this.assertAllowed(url)
    const key = `${this.options.source}:${url.toString()}`
    const cached = this.readCache(key, schema)
    if (cached && !this.isExpired(cached)) return cached

    let entry = this.inFlight.get(key)
    if (!entry) {
      const controller = new AbortController()
      const created: InFlight = {
        promise: this.fetchAndStore(key, url, schema, priority, controller.signal).finally(() => {
          if (this.inFlight.get(key) === created) this.inFlight.delete(key)
        }),
        controller,
        waiters: 0
      }
      this.inFlight.set(key, created)
      entry = created
    }

    try {
      return (await this.join(key, entry, signal)) as SourceResult<T>
    } catch (err) {
      const unreachable =
        err instanceof CoreError &&
        (err.code === 'BG_SOURCE_UNAVAILABLE' || err.code === 'BG_RATE_LIMITED')
      if (cached && unreachable) {
        return { ...cached, stale: true }
      }
      throw err
    }
  }

  /** Ortak isteğe katılır; `signal` iptal edilirse ayrılır, son bekleyen ayrılınca ağ isteği kesilir. */
  private join(
    key: string,
    entry: InFlight,
    signal: AbortSignal | undefined
  ): Promise<SourceResult<unknown>> {
    entry.waiters++
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        if (--entry.waiters === 0) {
          // İptal edilen ağ isteğine yeni gelen katılmasın.
          if (this.inFlight.get(key) === entry) this.inFlight.delete(key)
          entry.controller.abort(abortReason(signal!))
        }
        reject(abortReason(signal!))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const leave = (): void => signal?.removeEventListener('abort', onAbort)
      entry.promise.then(
        (value) => {
          leave()
          resolve(value)
        },
        (err: unknown) => {
          leave()
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      )
    })
  }

  private isExpired(entry: SourceResult<unknown>): boolean {
    const ttl =
      entry.data === null ? (this.options.notFoundTtlMs ?? this.options.ttlMs) : this.options.ttlMs
    return this.now() - entry.fetchedAt >= ttl
  }

  private readCache<T>(key: string, schema: z.ZodMiniType<T>): SourceResult<T> | null {
    const entry = this.options.cache?.get(key)
    if (!entry) return null
    if (entry.status === 404) {
      return { data: null, fetchedAt: entry.fetchedAt, fromCache: true, stale: false }
    }
    try {
      // Cache de yeniden doğrulanır: şema değiştiyse eski kayıt yok sayılır.
      const parsed = schema.safeParse(JSON.parse(entry.body))
      if (!parsed.success) return null
      return { data: parsed.data, fetchedAt: entry.fetchedAt, fromCache: true, stale: false }
    } catch {
      return null
    }
  }

  private async fetchAndStore<T>(
    key: string,
    url: URL,
    schema: z.ZodMiniType<T>,
    priority: Priority,
    signal: AbortSignal
  ): Promise<SourceResult<T>> {
    const baseSleep = this.options.retry?.sleep ?? ((ms: number) => defaultSleep(ms))
    const data = await withRetry(
      () => this.options.limiter.run(() => this.once(url, schema, signal), priority, signal),
      {
        ...DEFAULT_RETRY,
        // Tekrarlar görünür olsun (zaman aşımı, 5xx); URL/sorgu loglanmaz.
        onRetry: ({ attempt, delayMs, error }) =>
          logError(
            'background',
            new CoreError(
              error.code,
              `${this.options.source}: tekrar ${attempt} (${delayMs} ms sonra): ${error.message}`
            )
          ),
        ...this.options.retry,
        // Geri çekilme beklemesi de iptalle kesilir.
        sleep: (ms) => abortableSleep(baseSleep, ms, signal)
      }
    )
    const fetchedAt = this.now()
    this.options.cache?.set(key, this.options.source, {
      status: data === null ? 404 : 200,
      body: data === null ? '' : JSON.stringify(data),
      fetchedAt
    })
    return { data, fetchedAt, fromCache: false, stale: false }
  }

  private isAllowed(href: string): boolean {
    try {
      const url = new URL(href)
      return url.protocol === 'https:' && this.options.origins.includes(url.origin)
    } catch {
      return false
    }
  }

  private assertAllowed(url: URL): void {
    if (!this.isAllowed(url.href)) {
      throw new CoreError(
        'BG_HOST_NOT_ALLOWED',
        `${this.options.source}: izin listesi dışında adres reddedildi.`
      )
    }
  }

  private async once<T>(
    url: URL,
    schema: z.ZodMiniType<T>,
    cancel: AbortSignal
  ): Promise<T | null> {
    const { source } = this.options
    const target = new URL(url)

    // Yönlendirme (ör. Wikipedia başlık yönlendirmesi) yalnızca izinli host'larda kalabilir; hedef
    // istekten ÖNCE denetlenir (A3.3).
    let current = target
    let res = await this.fetchOne(current, cancel)
    for (let hop = 0; REDIRECT_STATUSES.has(res.status); hop++) {
      const location = res.headers.get('location')
      await res.body?.cancel()
      let next: URL | null = null
      try {
        if (location) next = new URL(location, current)
      } catch {
        next = null
      }
      if (!next || hop >= MAX_REDIRECTS) {
        throw new CoreError(
          'BG_RESPONSE_INVALID',
          `${source}: geçersiz veya çok fazla yönlendirme.`
        )
      }
      if (!this.isAllowed(next.href)) {
        throw new CoreError('BG_HOST_NOT_ALLOWED', `${source}: izin dışı yönlendirme reddedildi.`)
      }
      current = next
      res = await this.fetchOne(current, cancel)
    }

    if (res.status === 404) {
      await res.body?.cancel()
      return null
    }
    if (!res.ok) {
      await res.body?.cancel()
      throw this.httpError(res)
    }

    const tooLarge = (): CoreError =>
      new CoreError('BG_RESPONSE_INVALID', `${source}: yanıt boyut sınırını aşıyor.`)
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      await res.body?.cancel()
      throw tooLarge()
    }
    let text: Buffer | null
    try {
      text = await readLimited(res, MAX_BODY_BYTES)
    } catch (cause) {
      if (cancel.aborted) throw abortReason(cancel)
      throw new CoreError('BG_SOURCE_UNAVAILABLE', `${source}: yanıt okunamadı.`, { cause })
    }
    if (!text) throw tooLarge()
    let body: unknown
    try {
      body = JSON.parse(text.toString('utf8'))
    } catch (cause) {
      throw new CoreError('BG_RESPONSE_INVALID', `${source}: yanıt JSON değil.`, { cause })
    }
    const bodyError = this.options.inspectBody?.(body)
    if (bodyError) {
      if (bodyError.code === 'BG_RATE_LIMITED') {
        const pausedMs = this.pauseSource(bodyError.retryAfterMs)
        throw new CoreError(bodyError.code, bodyError.message, {
          status: bodyError.status,
          retryAfterMs: pausedMs,
          ...(bodyError.params ? { params: bodyError.params } : {})
        })
      }
      throw bodyError
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new CoreError('BG_RESPONSE_INVALID', `${source}: yanıt beklenen biçimde değil.`)
    }
    return parsed.data
  }

  /** Tek HTTP adımı; yönlendirme izlenmez. */
  private async fetchOne(url: URL, cancel: AbortSignal): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        redirect: 'manual',
        headers: {
          'User-Agent': this.options.userAgent,
          Accept: 'application/json',
          ...this.options.headers
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          cancel
        ])
      })
    } catch (cause) {
      if (cancel.aborted) throw abortReason(cancel)
      throw new CoreError('BG_SOURCE_UNAVAILABLE', `${this.options.source}: kaynağa ulaşılamadı.`, {
        cause
      })
    }
  }

  private httpError(res: Response): CoreError {
    const { source } = this.options
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), this.now())
    const rateLimited =
      res.status === 429 || (res.status === 503 && this.options.treat503AsRateLimit)
    if (rateLimited) {
      // Duraklama ve tekrar denemesi aynı süreyi bekler (V8: Retry-After 0 → 0 ms tekrar).
      const pausedMs = this.pauseSource(retryAfterMs)
      return new CoreError('BG_RATE_LIMITED', `${source}: hız sınırı (HTTP ${res.status}).`, {
        status: res.status,
        retryAfterMs: pausedMs
      })
    }
    if (res.status >= 500) {
      return new CoreError(
        'BG_SOURCE_UNAVAILABLE',
        `${source}: kaynak hatası (HTTP ${res.status}).`,
        {
          status: res.status,
          retryAfterMs
        }
      )
    }
    return new CoreError('BG_REQUEST_FAILED', `${source}: istek reddedildi (HTTP ${res.status}).`, {
      status: res.status
    })
  }

  /**
   * Kaynağı duraklatır; uygulanan süreyi döner. Retry-After politikadaki süreden kısa olsa (ör. 0)
   * bile en az o kadar beklenir (V8 gözlemi: MusicBrainz 503 + 0 ms tekrar → art arda 503).
   */
  private pauseSource(retryAfterMs: number | undefined): number {
    const floor = this.options.rateLimitPauseMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS
    const ms = Math.max(retryAfterMs ?? 0, floor)
    this.options.limiter.pause(ms)
    logError(
      'background',
      new CoreError('BG_RATE_LIMITED', `${this.options.source}: ${ms} ms duraklatıldı.`)
    )
    return ms
  }
}
