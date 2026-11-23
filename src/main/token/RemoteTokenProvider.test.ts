import { describe, expect, it, vi } from 'vitest'
import { RemoteTokenProvider, REFRESH_MARGIN_SECONDS } from './RemoteTokenProvider'

// Sahte token servisi (enjekte fetch; gerçek ağ yok). JWT imzası istemcide doğrulanmaz (Apple doğrular);
// yalnızca biçim, alg ve exp tutarlılığı.
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
const jwt = (exp: number, alg = 'ES256') =>
  `${b64({ alg, kid: 'KEY1234567' })}.${b64({ iss: 'TEAM123456', iat: exp - 3600, exp })}.c2ln`

function setup(reply: (n: number) => Response | Error) {
  const clock = { t: 1_000_000 }
  let calls = 0
  const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
    void url
    void init
    const r = reply(++calls)
    if (r instanceof Error) throw r
    return r
  })
  const provider = new RemoteTokenProvider({
    url: 'https://token.example/v1/developer-token',
    appVersion: '1.0.0',
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => clock.t,
    retry: { retries: 2, sleep: async () => {} }
  })
  return { provider, fetch, clock }
}
const ok = (token: string, expiresAt: number) => Response.json({ token, expiresAt })

describe('RemoteTokenProvider (4.1)', () => {
  it('token’ı alır, önbelleğe alır; süresi dolmadan yeniler; eşzamanlı çağrılar tek istek', async () => {
    const { provider, fetch, clock } = setup(() => ok(jwt(clock.t + 6 * 3600), clock.t + 6 * 3600))
    const [a, b] = await Promise.all([provider.getDeveloperToken(), provider.getDeveloperToken()])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('https://token.example/v1/developer-token')
    expect(init?.headers).toMatchObject({ 'x-am-client': '1.0.0' })
    clock.t += 6 * 3600 - REFRESH_MARGIN_SECONDS - 10
    await provider.getDeveloperToken()
    expect(fetch).toHaveBeenCalledTimes(1)
    clock.t += 20
    await provider.getDeveloperToken()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('geçici hata (ağ, 429, 5xx) tekrar denenir', async () => {
    const exp = 1_000_000 + 3600
    const { provider, fetch } = setup((n) =>
      n === 1
        ? new TypeError('fetch failed')
        : n === 2
          ? new Response('', { status: 429, headers: { 'retry-after': '1' } })
          : ok(jwt(exp), exp)
    )
    await expect(provider.getDeveloperToken()).resolves.toContain('.')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each<[string, () => Response]>([
    ['JSON değil', () => new Response('<html>', { status: 200 })],
    ['biçim', () => Response.json({ token: 'abc', expiresAt: 1 })],
    ['alg', () => ok(jwt(1_003_600, 'HS256'), 1_003_600)],
    ['exp uyumsuz', () => ok(jwt(1_003_600), 1_009_999)],
    ['süresi dolmuş', () => ok(jwt(1_000_030), 1_000_030)],
    ['403', () => new Response('', { status: 403 })]
  ])('geçersiz yanıt reddedilir: %s (token/URL sorgusu hata mesajında yok)', async (_l, reply) => {
    const { provider } = setup(reply)
    const err = (await provider.getDeveloperToken().catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain('eyJ')
  })

  it('invalidate → önbellek atılır, sonraki çağrı servise gider (A3.1)', async () => {
    const { provider, fetch, clock } = setup((n) =>
      ok(jwt(clock.t + 6 * 3600 + n), clock.t + 6 * 3600 + n)
    )
    const first = await provider.getDeveloperToken()
    expect(await provider.getDeveloperToken()).toBe(first)
    provider.invalidate()
    const second = await provider.getDeveloperToken()
    expect(second).not.toBe(first)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('yönlendirme izlenmez (P8, F3): 3xx hata, token alınmaz', async () => {
    const { provider, fetch } = setup(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.example/t' } })
    )
    await expect(provider.getDeveloperToken()).rejects.toBeInstanceOf(Error)
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
  })

  it('yalnızca https ve kullanıcı bilgisiz adres', () => {
    for (const url of ['http://token.example/x', 'https://u:p@token.example/x', 'bozuk']) {
      expect(() => new RemoteTokenProvider({ url, appVersion: '1' })).toThrow(
        expect.objectContaining({ code: 'TOKEN_PROVIDER_UNAVAILABLE' })
      )
    }
  })
})
