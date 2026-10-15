import { http, HttpResponse } from 'msw'
import { z } from 'zod/mini'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '@shared/errors'
import { buildUserAgent } from '@shared/app-config'
import { MemoryResponseCache } from './cache'
import { createSourceClient } from './sources/factory'
import { SOURCE_POLICIES } from './sources/policies'
import { MAX_BODY_BYTES } from './sourceClient'
import { hangingFetch, TEST_USER_AGENT, useMswServer, virtualClock } from './testing'

const MB = 'https://musicbrainz.org/ws/2/recording/abc'
const Body = z.object({ id: z.string() })

const seen: { url: URL; headers: Headers }[] = []
const server = useMswServer()

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  seen.length = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

/** Her isteği kaydeder ve sıradaki yanıtı döner. */
function respond(...replies: (() => Response)[]) {
  let i = 0
  return ({ request }: { request: Request }) => {
    seen.push({ url: new URL(request.url), headers: request.headers })
    const reply = replies[Math.min(i++, replies.length - 1)]!
    return reply()
  }
}

function setup(
  id: Parameters<typeof createSourceClient>[0] = 'musicbrainz',
  extras = {},
  onRetry?: (error: CoreError) => void
) {
  const clock = virtualClock()
  const cache = new MemoryResponseCache()
  const client = createSourceClient(
    id,
    {
      userAgent: TEST_USER_AGENT,
      cache,
      now: clock.now,
      sleep: clock.sleep,
      retry: { random: () => 0, ...(onRetry ? { onRetry: ({ error }) => onRetry(error) } : {}) }
    },
    extras
  )
  return { client, cache, clock }
}

describe('User-Agent (3.A1)', () => {
  it('her istekte tanımlayıcı User-Agent ve JSON kabulü gönderilir', async () => {
    server.use(
      http.get(
        MB,
        respond(() => HttpResponse.json({ id: 'abc' }))
      )
    )
    const { client } = setup()
    await client.getJson(new URL(MB), Body)
    expect(seen[0]!.headers.get('user-agent')).toBe(TEST_USER_AGENT)
    expect(seen[0]!.headers.get('accept')).toBe('application/json')
  })

  it('UA biçimi MusicBrainz önerisine uyar; iletişim bilgisi yoksa UA üretilmez', () => {
    expect(buildUserAgent('1.2.0')).toBe('RiffClient/1.2.0 ( https://github.com/Abrahamexe )')
    expect(buildUserAgent('1.0.0', { userAgentName: 'X', contact: 'me@example.com' })).toBe(
      'X/1.0.0 ( me@example.com )'
    )
    for (const contact of ['', 'http://insecure.example', 'not a url', 'a (b)']) {
      expect(() => buildUserAgent('1.0.0', { userAgentName: 'X', contact })).toThrow(CoreError)
    }
  })
})

describe('cache ve TTL', () => {
  it('TTL içinde ağa çıkılmaz; TTL dolunca yenilenir', async () => {
    server.use(
      http.get(
        MB,
        respond(
          () => HttpResponse.json({ id: 'v1' }),
          () => HttpResponse.json({ id: 'v2' })
        )
      )
    )
    const { client, clock } = setup()
    expect((await client.getJson(new URL(MB), Body)).data).toEqual({ id: 'v1' })
    const hit = await client.getJson(new URL(MB), Body)
    expect(hit).toMatchObject({ data: { id: 'v1' }, fromCache: true, stale: false })
    expect(seen).toHaveLength(1)
    clock.advance(SOURCE_POLICIES.musicbrainz.ttlMs)
    expect((await client.getJson(new URL(MB), Body)).data).toEqual({ id: 'v2' })
    expect(seen).toHaveLength(2)
  })

  it('404 "bulunamadı" olarak döner ve cache’lenir', async () => {
    server.use(
      http.get(
        MB,
        respond(() => new HttpResponse(null, { status: 404 }))
      )
    )
    const { client } = setup()
    expect((await client.getJson(new URL(MB), Body)).data).toBeNull()
    expect((await client.getJson(new URL(MB), Body)).fromCache).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it('çevrimdışıyken eski cache döner (stale); hiç cache yoksa BG_SOURCE_UNAVAILABLE', async () => {
    server.use(
      http.get(
        MB,
        respond(
          () => HttpResponse.json({ id: 'eski' }),
          () => HttpResponse.error()
        )
      )
    )
    const { client, clock } = setup()
    await client.getJson(new URL(MB), Body)
    clock.advance(SOURCE_POLICIES.musicbrainz.ttlMs + 1)
    expect(await client.getJson(new URL(MB), Body)).toMatchObject({
      data: { id: 'eski' },
      fromCache: true,
      stale: true
    })

    const other = 'https://musicbrainz.org/ws/2/recording/yok'
    server.use(http.get(other, () => HttpResponse.error()))
    await expect(client.getJson(new URL(other), Body)).rejects.toMatchObject({
      code: 'BG_SOURCE_UNAVAILABLE'
    })
  })
})

describe('hız sınırı yanıtları ve geri çekilme', () => {
  it('429 + Retry-After: kaynak duraklatılır, süre dolunca tekrar denenir', async () => {
    const url = 'https://lrclib.net/api/get?x=1'
    server.use(
      http.get(
        'https://lrclib.net/api/get',
        respond(
          () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '7' } }),
          () => HttpResponse.json({ id: 'ok' })
        )
      )
    )
    const { client, clock } = setup('lrclib')
    const t0 = clock.now()
    expect((await client.getJson(new URL(url), Body)).data).toEqual({ id: 'ok' })
    expect(seen).toHaveLength(2)
    expect(clock.now() - t0).toBeGreaterThanOrEqual(7_000)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BG_001 BG_RATE_LIMITED'))
  })

  it('MusicBrainz 503 = hız sınırı: geri çekilir; tekrarlar tükenirse BG_RATE_LIMITED', async () => {
    server.use(
      http.get(
        MB,
        respond(() => new HttpResponse(null, { status: 503 }))
      )
    )
    const { client, clock } = setup()
    const t0 = clock.now()
    await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
      code: 'BG_RATE_LIMITED',
      status: 503
    })
    // 1 ilk + 2 tekrar; her biri en az duraklatma süresi kadar arayla.
    expect(seen).toHaveLength(3)
    expect(clock.now() - t0).toBeGreaterThanOrEqual(
      2 * SOURCE_POLICIES.musicbrainz.rateLimitPauseMs
    )
  })

  it('Retry-After: 0 olsa da en az politika süresi beklenir (V8: 0 ms tekrar → art arda 503)', async () => {
    const at: number[] = []
    server.use(
      http.get(MB, () => {
        at.push(clock.now())
        return at.length === 1
          ? new HttpResponse(null, { status: 503, headers: { 'Retry-After': '0' } })
          : HttpResponse.json({ id: 'ok' })
      })
    )
    const { client, clock } = setup()
    await expect(client.getJson(new URL(MB), Body)).resolves.toMatchObject({ data: { id: 'ok' } })
    expect(at).toHaveLength(2)
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(SOURCE_POLICIES.musicbrainz.rateLimitPauseMs)
  })

  it('gövdede bildirilen hız sınırı (inspectBody) da geri çekilmeyi tetikler', async () => {
    const base = 'https://lrclib.net/api/get'
    server.use(
      http.get(
        base,
        respond(
          () => HttpResponse.json({ error: 29, message: 'Rate Limit Exceeded' }),
          () => HttpResponse.json({ id: 'ok' })
        )
      )
    )
    const { client } = setup('lrclib', {
      inspectBody: (b: unknown) =>
        (b as { error?: number }).error === 29 ? new CoreError('BG_RATE_LIMITED', 'gövde 29') : null
    })
    expect((await client.getJson(new URL(`${base}?m=1`), Body)).data).toEqual({ id: 'ok' })
    expect(seen).toHaveLength(2)
  })

  it('diğer 4xx tekrar denenmez: BG_REQUEST_FAILED', async () => {
    server.use(
      http.get(
        MB,
        respond(() => new HttpResponse(null, { status: 400 }))
      )
    )
    const { client } = setup()
    await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
      code: 'BG_REQUEST_FAILED'
    })
    expect(seen).toHaveLength(1)
  })
})

describe('güvenlik ve doğrulama', () => {
  it('izin listesi dışındaki host ve http reddedilir (ağa çıkmadan)', async () => {
    const { client } = setup()
    for (const url of ['https://evil.example/ws/2/', 'http://musicbrainz.org/ws/2/']) {
      await expect(client.getJson(new URL(url), Body)).rejects.toMatchObject({
        code: 'BG_HOST_NOT_ALLOWED'
      })
    }
    expect(seen).toHaveLength(0)
  })

  it('şemaya uymayan yanıt BG_RESPONSE_INVALID; cache’e yazılmaz', async () => {
    server.use(
      http.get(
        MB,
        respond(() => HttpResponse.json({ id: 42 }))
      )
    )
    const { client, cache } = setup()
    await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
      code: 'BG_RESPONSE_INVALID'
    })
    expect(cache.entries.size).toBe(0)
  })

  describe('yönlendirme ve gövde sınırı (A3.3)', () => {
    const redirect =
      (location: string, status = 302) =>
      () =>
        new HttpResponse(null, { status, headers: { location } })

    it('izinli yönlendirme izlenir (göreli Location dahil)', async () => {
      server.use(
        http.get(MB, respond(redirect('/ws/2/recording/def', 301))),
        http.get(
          'https://musicbrainz.org/ws/2/recording/def',
          respond(() => HttpResponse.json({ id: 'def' }))
        )
      )
      const { client } = setup()
      expect((await client.getJson(new URL(MB), Body)).data).toEqual({ id: 'def' })
      expect(seen.map((s) => s.url.pathname)).toEqual([
        '/ws/2/recording/abc',
        '/ws/2/recording/def'
      ])
    })

    it('izin dışı host’a yönlendirme istek atılmadan reddedilir; tekrar denenmez', async () => {
      const evil = vi.fn(() => HttpResponse.json({ id: 'x' }))
      server.use(
        http.get(MB, respond(redirect('https://evil.example/steal'))),
        http.get('https://evil.example/steal', evil)
      )
      const { client } = setup()
      await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
        code: 'BG_HOST_NOT_ALLOWED'
      })
      expect(evil).not.toHaveBeenCalled()
      expect(seen).toHaveLength(1)
    })

    it('http’ye düşüren yönlendirme de reddedilir', async () => {
      server.use(http.get(MB, respond(redirect('http://musicbrainz.org/ws/2/recording/abc'))))
      const { client } = setup()
      await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
        code: 'BG_HOST_NOT_ALLOWED'
      })
    })

    it('3 adımdan fazla yönlendirme / Location yok → BG_RESPONSE_INVALID', async () => {
      server.use(http.get('https://musicbrainz.org/ws/2/loop', respond(redirect('/ws/2/loop'))))
      const { client } = setup()
      await expect(
        client.getJson(new URL('https://musicbrainz.org/ws/2/loop'), Body)
      ).rejects.toMatchObject({ code: 'BG_RESPONSE_INVALID' })
      expect(seen).toHaveLength(4) // ilk istek + 3 yönlendirme

      seen.length = 0
      server.use(
        http.get(
          MB,
          respond(() => new HttpResponse(null, { status: 302 }))
        )
      )
      await expect(setup().client.getJson(new URL(MB), Body)).rejects.toMatchObject({
        code: 'BG_RESPONSE_INVALID'
      })
    })

    it('sınırı aşan gövde kesilir: BG_RESPONSE_INVALID, cache’e yazılmaz', async () => {
      const big = `{"id":"${'x'.repeat(MAX_BODY_BYTES)}"}`
      server.use(
        http.get(
          MB,
          respond(
            () =>
              new HttpResponse(
                new ReadableStream({
                  start(c) {
                    c.enqueue(new TextEncoder().encode(big))
                    c.close()
                  }
                }),
                { headers: { 'content-type': 'application/json' } }
              )
          )
        )
      )
      const { client, cache } = setup()
      await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
        code: 'BG_RESPONSE_INVALID'
      })
      expect(cache.entries.size).toBe(0)
    })

    it('bildirilen boyut sınırı aşıyorsa gövde okunmaz', async () => {
      server.use(
        http.get(
          MB,
          respond(
            () =>
              new HttpResponse('{"id":"a"}', {
                headers: { 'content-length': String(MAX_BODY_BYTES + 1) }
              })
          )
        )
      )
      const { client } = setup()
      await expect(client.getJson(new URL(MB), Body)).rejects.toMatchObject({
        code: 'BG_RESPONSE_INVALID'
      })
    })
  })

  it('aynı anda yapılan aynı istek tek ağ isteğine iner', async () => {
    server.use(
      http.get(
        MB,
        respond(() => HttpResponse.json({ id: 'abc' }))
      )
    )
    const { client } = setup()
    const results = await Promise.all([1, 2, 3].map(() => client.getJson(new URL(MB), Body)))
    expect(results.map((r) => r.data)).toEqual([{ id: 'abc' }, { id: 'abc' }, { id: 'abc' }])
    expect(seen).toHaveLength(1)
  })
})

describe('iptal (3.A8)', () => {
  const gated = () => {
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    return { gate, open }
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }

  it('ağdaki istek kesilir: BG_CANCELLED, tekrar denenmez, cache’e yazılmaz', async () => {
    const hung: URL[] = []
    const clock = virtualClock()
    const cache = new MemoryResponseCache()
    const client = createSourceClient('musicbrainz', {
      userAgent: TEST_USER_AGENT,
      cache,
      fetch: hangingFetch(() => true, hung),
      now: clock.now,
      sleep: clock.sleep,
      retry: { random: () => 0 }
    })
    const ctl = new AbortController()
    const pending = client.getJson(new URL(MB), Body, { signal: ctl.signal })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'BG_CANCELLED', id: 'BG_008' })
    await settle()
    expect(hung).toHaveLength(1)
    ctl.abort()
    await rejected
    await settle()
    expect(hung).toHaveLength(1) // geri çekilme/yeniden deneme yok
    expect(cache.entries.size).toBe(0)
  })

  it('zaten iptal edilmiş sinyalle ağa çıkılmaz', async () => {
    const { client } = setup()
    await expect(
      client.getJson(new URL(MB), Body, { signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    expect(seen).toHaveLength(0)
  })

  it('ortak istek: bir çağıranın iptali diğerinin sonucunu bozmaz', async () => {
    const { gate, open } = gated()
    // B1 kök neden: MSW'nin sahte TLS soketi tam paket yükünde çöküyordu (undici
    // `ERR_TLS_CERT_ALTNAME_INVALID` assert'i) → ilk deneme BG_SOURCE_UNAVAILABLE → doğru biçimde
    // yeniden denenip 2 istek görünüyordu. Bu test ağ katmanını değil paylaşım mantığını sınar:
    // MSW yerine kapılı sahte fetch (hangingFetch deseni).
    const retries: string[] = []
    const gatedFetch: typeof fetch = async (input) => {
      seen.push({
        url: new URL(input instanceof Request ? input.url : input),
        headers: new Headers()
      })
      await gate
      return HttpResponse.json({ id: 'abc' })
    }
    const clock = virtualClock()
    const client = createSourceClient('musicbrainz', {
      userAgent: TEST_USER_AGENT,
      fetch: gatedFetch,
      now: clock.now,
      sleep: clock.sleep,
      retry: {
        random: () => 0,
        onRetry: ({ error }) => retries.push(`${error.code}: ${error.message}`)
      }
    })
    const ctl = new AbortController()
    const cancelled = client.getJson(new URL(MB), Body, { signal: ctl.signal })
    const cancelledCheck = expect(cancelled).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    const kept = client.getJson(new URL(MB), Body)
    await settle()
    ctl.abort()
    await cancelledCheck
    open()
    expect((await kept).data).toEqual({ id: 'abc' })
    expect(retries).toEqual([])
    expect(seen).toHaveLength(1)
  })

  it('kota: sırada bekleyen iptal edilen istek hız sınırı kotasını harcamaz', async () => {
    const { gate, open } = gated()
    const clock = virtualClock()
    const started: Record<string, number> = {}
    // MSW yerine kapılı sahte fetch: MSW'nin sahte TLS soketi yük altında bozulup araya yeniden
    // deneme sokuyordu (tam `npm run check` koşusunda +500 ms; hangingFetch deseni).
    const gatedFetch: typeof fetch = async (input) => {
      const id = new URL(input instanceof Request ? input.url : String(input)).pathname
        .split('/')
        .pop()!
      started[id] = clock.now() - t0
      if (id === 'one') await gate
      return HttpResponse.json({ id })
    }
    const client = createSourceClient('musicbrainz', {
      userAgent: TEST_USER_AGENT,
      fetch: gatedFetch,
      now: clock.now,
      sleep: clock.sleep,
      retry: { random: () => 0 }
    })
    const t0 = clock.now()
    const url = (id: string) => new URL(`https://musicbrainz.org/ws/2/recording/${id}`)
    const first = client.getJson(url('one'), Body)
    await settle() // 'one' ağda, MusicBrainz yuvası dolu
    const ctl = new AbortController()
    const second = client.getJson(url('two'), Body, { signal: ctl.signal })
    const secondCheck = expect(second).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    const third = client.getJson(url('three'), Body)
    await settle()
    ctl.abort()
    await secondCheck
    open()
    await Promise.all([first, third])
    expect(started.two).toBeUndefined() // iptal edilen hiç istek atmadı
    // 'two' jeton harcamış olsaydı 'three' en erken iki aralık sonra başlardı.
    const interval = Math.ceil(1_000 / SOURCE_POLICIES.musicbrainz.perSecond)
    expect(started.three).toBe(interval)
  })
})
