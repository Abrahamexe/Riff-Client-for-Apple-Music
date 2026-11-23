import { APPLE_ID_PATTERN, importAppleKey, signDeveloperToken } from './jwt'

// Riff Client developer token servisi (PLAN 4.1) — Cloudflare Worker.
//  - `.p8` YALNIZCA bu servisin gizli deposundadır (`wrangler secret put`); istemci pakette yoktur.
//  - Kısa ömürlü token (varsayılan 6 sa); istemci süresi dolmadan yeniler.
//  - IP başına hız sınırı (Workers Rate Limiting bağlamı); aşımda 429 + Retry-After.
//  - Basit izleme: her yanıt tek satır yapılandırılmış log (olay + durum); IP ve token LOGLANMAZ.
// Not: developer token istemcide her zaman görülebilir; amaç `.p8`'i korumak ve kötüye kullanılan
// token'ın etkisini kısa ömürle sınırlamaktır. Kurulum: server/token-service/README.md.

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  APPLE_TEAM_ID?: string
  APPLE_KEY_ID?: string
  /** .p8 dosyasının içeriği (PEM). */
  APPLE_PRIVATE_KEY?: string
  /** Token ömrü (sn); varsayılan 6 sa. */
  TOKEN_TTL_SECONDS?: string
  RATE_LIMITER?: RateLimiter
}

export const TOKEN_PATH = '/v1/developer-token'
export const DEFAULT_TTL_SECONDS = 6 * 60 * 60

/** İzolat belleğinde: token ömrünün yarısı geçene kadar aynı token verilir (her istekte imza yok). */
let cache: { token: string; expiresAt: number; issuedAt: number } | null = null
let keyCache: { pem: string; key: CryptoKey } | null = null

/** Test: izolat önbelleğini sıfırlar. */
export function resetCache(): void {
  cache = null
  keyCache = null
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra
    }
  })

const log = (event: string, status: number): void => console.log(JSON.stringify({ event, status }))

export async function handle(
  request: Request,
  env: Env,
  nowMs: () => number = Date.now
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') return new Response('ok', { status: 200 })
  if (url.pathname !== TOKEN_PATH) return json(404, { error: 'not_found' })
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' })

  if (env.RATE_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key: ip })
    if (!success) {
      log('rate_limited', 429)
      return json(429, { error: 'rate_limited' }, { 'retry-after': '60' })
    }
  }

  const teamId = env.APPLE_TEAM_ID ?? ''
  const keyId = env.APPLE_KEY_ID ?? ''
  const pem = env.APPLE_PRIVATE_KEY ?? ''
  if (!APPLE_ID_PATTERN.test(teamId) || !APPLE_ID_PATTERN.test(keyId) || pem === '') {
    log('misconfigured', 500)
    return json(500, { error: 'misconfigured' })
  }

  const nowSec = Math.floor(nowMs() / 1000)
  const ttl = Number(env.TOKEN_TTL_SECONDS ?? DEFAULT_TTL_SECONDS) || DEFAULT_TTL_SECONDS
  if (!cache || nowSec - cache.issuedAt >= (cache.expiresAt - cache.issuedAt) / 2) {
    try {
      if (keyCache?.pem !== pem) keyCache = { pem, key: await importAppleKey(pem) }
      const signed = await signDeveloperToken(keyCache.key, { teamId, keyId, nowSec, ttlSec: ttl })
      cache = { ...signed, issuedAt: nowSec }
    } catch {
      // Ayrıntı (anahtar içeriği) yanıta ve loga girmez.
      log('sign_failed', 500)
      return json(500, { error: 'sign_failed' })
    }
  }
  log('issued', 200)
  return json(200, { token: cache.token, expiresAt: cache.expiresAt })
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env)
}
