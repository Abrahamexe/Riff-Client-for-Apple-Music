import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackRef } from '@shared/background'
import { LyricsSchema } from '@shared/lyrics'
import { openDatabase, type Db } from '../db/connection'
import { MemoryResponseCache } from './cache'
import { BackgroundService } from './service'
import { createSourceClient } from './sources/factory'
import { LrclibSource, pickRecord, recordLyrics } from './sources/lrclib'
import { hangingFetch, TEST_USER_AGENT, useMswServer, virtualClock } from './testing'

// LRCLIB adaptörü (B11b). Gerçek ağa çıkılmaz: tüm istekler MSW ile karşılanır.

const server = useMswServer()
const log: { url: URL; ua: string | null }[] = []

const record = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Hurt',
  trackName: 'Hurt',
  artistName: 'Johnny Cash',
  albumName: 'American IV: The Man Comes Around',
  duration: 218,
  instrumental: false,
  hasWordSync: false,
  plainLyrics: 'I hurt myself today\nTo see if I still feel',
  syncedLyrics: '[00:20.00] I hurt myself today\n[00:25.50] To see if I still feel',
  lyricsfile: 'version: 1.0',
  ...over
})

const HURT: TrackRef = {
  title: 'Hurt',
  artist: 'Johnny Cash',
  album: 'American IV: The Man Comes Around',
  durationMs: 218_400
}

/** `/api/get` yanıtı ve başlığa göre `/api/search` sonuçları. */
function lrclib(get: unknown, search: Record<string, unknown[]> = {}) {
  server.use(
    http.get('https://lrclib.net/api/get', ({ request }) => {
      log.push({ url: new URL(request.url), ua: request.headers.get('user-agent') })
      return get
        ? HttpResponse.json(get)
        : HttpResponse.json(
            { message: 'Failed to find specified track', name: 'TrackNotFound', statusCode: 404 },
            { status: 404 }
          )
    }),
    http.get('https://lrclib.net/api/search', ({ request }) => {
      const url = new URL(request.url)
      log.push({ url, ua: request.headers.get('user-agent') })
      return HttpResponse.json(search[url.searchParams.get('track_name') ?? ''] ?? [])
    })
  )
}

function source() {
  const clock = virtualClock()
  const cache = new MemoryResponseCache()
  const deps = { userAgent: TEST_USER_AGENT, cache, now: clock.now, sleep: clock.sleep }
  return { lrclib: new LrclibSource(createSourceClient('lrclib', deps)), clock }
}

beforeEach(() => {
  log.length = 0
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('LRCLIB kaynağı (B11b)', () => {
  it('/api/get: ad, sanatçı, albüm ve yuvarlanmış süre (sn) gönderilir; tanımlayıcı User-Agent', async () => {
    lrclib(record())
    const lyrics = await source().lrclib.find(HURT)
    expect(lyrics).toEqual({
      kind: 'synced',
      lines: [
        { timeMs: 20_000, text: 'I hurt myself today' },
        { timeMs: 25_500, text: 'To see if I still feel' }
      ]
    })
    expect(LyricsSchema.safeParse(lyrics).success).toBe(true)
    expect(log).toHaveLength(1)
    const { url, ua } = log[0]!
    expect(Object.fromEntries(url.searchParams)).toEqual({
      track_name: 'Hurt',
      artist_name: 'Johnny Cash',
      album_name: 'American IV: The Man Comes Around',
      duration: '218'
    })
    expect(ua).toBe(TEST_USER_AGENT)
  })

  it('aynı şarkı ikinci kez istenince ağa çıkılmaz (cache)', async () => {
    lrclib(record())
    const { lrclib: src } = source()
    await src.find(HURT)
    await src.find(HURT)
    expect(log).toHaveLength(1)
  })

  it('/api/get bulamazsa arama: yanlış sanatçı ve süresi tutmayan elenir, senkron tercih edilir', async () => {
    lrclib(null, {
      Hurt: [
        record({ id: 2, artistName: 'Nine Inch Nails', duration: 373 }),
        record({ id: 3, duration: 260 }),
        record({ id: 4, syncedLyrics: null, plainLyrics: 'düz' }),
        record({ id: 5, syncedLyrics: '[00:01.00] doğru' })
      ]
    })
    expect(await source().lrclib.find(HURT)).toEqual({
      kind: 'synced',
      lines: [{ timeMs: 1_000, text: 'doğru' }]
    })
    expect(log.map((l) => l.url.pathname)).toEqual(['/api/get', '/api/search'])
    expect(Object.fromEntries(log[1]!.url.searchParams)).toEqual({
      track_name: 'Hurt',
      artist_name: 'Johnny Cash'
    })
  })

  it('süre 3 sn’den fazla tutmuyorsa senkron söz düz metin olarak kullanılır (zaman kaymasın)', () => {
    expect(pickRecord(HURT, [record({ duration: 228 })])).toEqual({
      kind: 'plain',
      lines: [
        { timeMs: null, text: 'I hurt myself today' },
        { timeMs: null, text: 'To see if I still feel' }
      ]
    })
  })

  it('bulunamazsa başlıktaki ekler atılarak bir kez daha aranır; o da boşsa "none"', async () => {
    const ref: TrackRef = { title: 'Hurt (Remastered 2011)', artist: 'Johnny Cash' }
    lrclib(null, { Hurt: [record()] })
    expect((await source().lrclib.find(ref)).kind).toBe('synced')
    expect(log.map((l) => l.url.searchParams.get('track_name'))).toEqual([
      'Hurt (Remastered 2011)',
      'Hurt (Remastered 2011)',
      'Hurt'
    ])

    log.length = 0
    lrclib(null)
    expect(await source().lrclib.find({ title: 'Yok', artist: 'Kimse' })).toEqual({
      kind: 'none',
      lines: []
    })
    // Ek yoksa ikinci arama yapılmaz.
    expect(log).toHaveLength(2)
  })

  it('enstrümantal kayıt; bozuk alanlar kaydı düşürmez', () => {
    expect(
      recordLyrics(record({ instrumental: true, plainLyrics: null, syncedLyrics: null }) as never)
    ).toEqual({ kind: 'instrumental', lines: [] })
    expect(recordLyrics(null)).toEqual({ kind: 'none', lines: [] })
  })

  it('429: Retry-After’a uyulur, sonra tekrar denenir', async () => {
    let calls = 0
    server.use(
      http.get('https://lrclib.net/api/get', () =>
        ++calls === 1
          ? new HttpResponse('slow down', { status: 429, headers: { 'Retry-After': '3' } })
          : HttpResponse.json(record())
      )
    )
    const { lrclib: src, clock } = source()
    expect((await src.find(HURT)).kind).toBe('synced')
    expect(calls).toBe(2)
    expect(clock.sleeps.some((ms) => ms >= 3_000)).toBe(true)
  })

  it('istekler sıralı ve aralarında en az 400 ms (LRCLIB: 200–500 ms)', async () => {
    const times: number[] = []
    const { lrclib: src, clock } = source()
    server.use(
      http.get('https://lrclib.net/api/get', () => {
        times.push(clock.now())
        return HttpResponse.json(null, { status: 404 })
      }),
      http.get('https://lrclib.net/api/search', () => {
        times.push(clock.now())
        return HttpResponse.json([])
      })
    )
    await src.find({ title: 'A (feat. B)', artist: 'C' })
    expect(times).toHaveLength(3)
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(400)
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(400)
  })
})

describe('BackgroundService.lyrics (B11b)', () => {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  const service = (fetchImpl?: typeof fetch) => {
    const clock = virtualClock()
    return new BackgroundService({
      db,
      userAgent: TEST_USER_AGENT,
      emit: () => {},
      now: clock.now,
      sleep: clock.sleep,
      fetch: fetchImpl
    })
  }

  it('yeni şarkının sözleri istenince önceki istek BG_CANCELLED ile biter', async () => {
    lrclib(record())
    const svc = service(hangingFetch((u) => u.searchParams.get('track_name') === 'Yavaş'))
    const slow = svc.lyrics({ title: 'Yavaş', artist: 'X' })
    const fast = await svc.lyrics(HURT)
    await expect(slow).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    expect(fast.kind).toBe('synced')
  })

  it('önden yükleme süren kullanıcı isteğini iptal etmez; sonucu cache’e yazar', async () => {
    lrclib(record())
    const svc = service()
    const user = svc.lyrics(HURT)
    svc.prefetchLyrics({
      title: 'Hurt',
      artist: 'Johnny Cash',
      album: 'Başka',
      durationMs: 218_000
    })
    expect((await user).kind).toBe('synced')
    await new Promise((r) => setTimeout(r, 20))
    const before = log.length
    await svc.lyrics({ title: 'Hurt', artist: 'Johnny Cash', album: 'Başka', durationMs: 218_000 })
    expect(log.length).toBe(before)
  })

  it('ağ yokken cache’teki sözler kullanılır; çıkışta (clear) cache silinir', async () => {
    lrclib(record())
    const svc = service()
    await svc.lyrics(HURT)
    server.use(http.get('https://lrclib.net/*', () => HttpResponse.error()))
    expect((await svc.lyrics(HURT)).kind).toBe('synced')
    svc.clear()
    await expect(svc.lyrics(HURT)).rejects.toMatchObject({ code: 'BG_SOURCE_UNAVAILABLE' })
  })
})
