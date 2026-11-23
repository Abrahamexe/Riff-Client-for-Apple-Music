import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackBackgroundSchema, type BackgroundProgress, type TrackRef } from '@shared/background'
import type { WorkerEvent } from '@shared/ipc-contract'
import { openDatabase, type Db } from '../db/connection'
import { CANDIDATES, MBID, musicBrainzHandlers } from './musicbrainz.fixtures'
import { BackgroundService, TRACK_TTL_MS } from './service'
import { hangingFetch, TEST_USER_AGENT, useMswServer, virtualClock } from './testing'
import { wikimediaHandlers } from './wikimedia.fixtures'

const server = useMswServer()
const mbLog: URL[] = []
const wmLog: URL[] = []
let db: Db

beforeEach(() => {
  mbLog.length = 0
  wmLog.length = 0
  server.use(
    ...musicBrainzHandlers(
      {
        isrc: { GBUM71029604: [CANDIDATES.boho] },
        search: [['Hurt', [CANDIDATES.hurt, CANDIDATES.hurtLive]]]
      },
      mbLog
    ),
    ...wikimediaHandlers(wmLog)
  )
  db = openDatabase(':memory:')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

const BOHO: TrackRef = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  isrc: 'GBUM71029604',
  durationMs: 354_947
}
const HURT: TrackRef = { title: 'Hurt', artist: 'Johnny Cash', durationMs: 218_000 }
const offline = () => server.use(http.get('https://*', () => HttpResponse.error()))
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

function setup(fetchImpl?: typeof fetch) {
  const clock = virtualClock()
  const events: WorkerEvent[] = []
  const service = new BackgroundService({
    db,
    userAgent: TEST_USER_AGENT,
    emit: (e) => events.push(e),
    now: clock.now,
    sleep: clock.sleep,
    fetch: fetchImpl
  })
  return { service, clock, events }
}

describe('BackgroundService (3.A7)', () => {
  it('ilk istek kaynaklardan toplar; ikinci istek cache’ten ağa çıkmadan döner', async () => {
    const { service } = setup()
    const first = await service.get(BOHO, 'tr')
    expect(first).toMatchObject({ cached: false, stale: false })
    expect(TrackBackgroundSchema.safeParse(first.data).success).toBe(true)
    expect(first.data.match.recording?.mbid).toBe(MBID.recBoho)
    expect(first.data.artistSummary?.lang).toBe('tr')
    const requests = mbLog.length + wmLog.length

    const second = await service.get(BOHO, 'tr')
    expect(second).toMatchObject({ cached: true, stale: false, key: first.key })
    expect(second.data).toEqual(first.data)
    expect(mbLog.length + wmLog.length).toBe(requests)
  })

  it('ağ kesikken cache çalışır; eski sonuç döner, yenileme hatası okumayı bozmaz', async () => {
    const { service, clock, events } = setup()
    await service.get(BOHO, 'tr')
    offline()
    clock.advance(TRACK_TTL_MS + 1)
    const res = await service.get(BOHO, 'tr')
    expect(res).toMatchObject({ cached: true, stale: true })
    expect(res.data.credits.length).toBeGreaterThan(0)
    await settle()
    expect(events).toEqual([])
  })

  it('cache yokken ağ da yoksa açık hata (BG_SOURCE_UNAVAILABLE), uydurma veri yok', async () => {
    const { service } = setup()
    offline()
    await expect(service.get(HURT, 'en')).rejects.toMatchObject({ code: 'BG_SOURCE_UNAVAILABLE' })
  })

  it('eskiyen sonuç arka planda yenilenir; içerik değişince background:changed bildirilir', async () => {
    const { service, clock, events } = setup()
    const first = await service.get(HURT, 'en')
    clock.advance(TRACK_TTL_MS + 1)
    // Kaynakta yeni bilgi: kayda bir mühendis eklendi (HTTP cache'i de eskidiği için yeniden alınır).
    clock.advance(15 * 86_400_000)
    const detail = {
      ...CANDIDATES.hurt,
      isrcs: [],
      relations: [
        {
          type: 'engineer',
          'target-type': 'artist',
          attributes: [],
          artist: { id: MBID.mikeStone, name: 'Yeni Mühendis' }
        }
      ]
    }
    server.use(
      ...musicBrainzHandlers({
        search: [['Hurt', [CANDIDATES.hurt]]],
        recordings: { [MBID.recHurt]: detail }
      })
    )
    const res = await service.get(HURT, 'en')
    expect(res.stale).toBe(true)
    expect(res.data).toEqual(first.data)
    await settle()
    expect(events).toEqual([
      { event: 'background:changed', payload: { key: first.key, lang: 'en' } }
    ])
    const updated = await service.get(HURT, 'en')
    expect(updated.data.credits.map((c) => c.name)).toContain('Yeni Mühendis')
  })

  it('ön yükleme düşük öncelikli: bekleyen kullanıcı isteği ön yüklemenin sonraki isteğinden önce geçer', async () => {
    const { service } = setup()
    // Ön yüklemenin ilk MusicBrainz isteği (arama) kapıda bekletilir; MusicBrainz yuvası dolu.
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    server.use(
      http.get('https://musicbrainz.org/ws/2/recording', async ({ request }) => {
        mbLog.push(new URL(request.url))
        await gate
        return HttpResponse.json({ recordings: [CANDIDATES.hurt] })
      })
    )
    service.prefetch(HURT, 'en')
    await settle()
    const user = service.get(BOHO, 'tr') // kullanıcı isteği kuyrukta bekler
    await settle()
    open()
    await user
    await settle()
    const order = mbLog.map((u) => u.pathname)
    expect(order[0]).toBe('/ws/2/recording') // ön yükleme araması
    expect(order[1]).toBe('/ws/2/isrc/GBUM71029604') // kullanıcı, ön yüklemenin devamından önce
    expect(order.indexOf(`/ws/2/recording/${MBID.recHurt}`)).toBeGreaterThan(1)
    // Ön yüklenen şarkı artık cache'te: ağa çıkmadan döner.
    for (let i = 0; i < 10 && !(await service.get(HURT, 'en').then((r) => r.cached)); i++)
      await settle()
    const count = mbLog.length
    expect((await service.get(HURT, 'en')).cached).toBe(true)
    expect(mbLog.length).toBe(count)
  })

  it('taze cache varken ön yükleme ağa çıkmaz; aynı şarkı için eşzamanlı istekler birleşir', async () => {
    const { service } = setup()
    const [a, b] = await Promise.all([service.get(HURT, 'en'), service.get(HURT, 'en')])
    expect(a.data).toEqual(b.data)
    const count = mbLog.length
    service.prefetch(HURT, 'en')
    await settle()
    expect(mbLog.length).toBe(count)
  })

  it('çıkış: tüm arka plan tabloları boşalır', async () => {
    const { service } = setup()
    await service.get(BOHO, 'tr')
    service.clear()
    for (const t of ['bg_http_cache', 'bg_match', 'bg_track']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 })
    }
  })
})

describe('kademeli sonuç, yarım sonuç ve iptal (3.A8)', () => {
  const rows = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const progressOf = (events: WorkerEvent[], requestId: string): BackgroundProgress[] =>
    events
      .filter((e) => e.event === 'background:progress')
      .map((e) => e.payload as BackgroundProgress)
      .filter((p) => p.requestId === requestId)
  const gated = () => {
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    return { gate, open }
  }

  it('krediler özetten önce bildirilir; bölüm durumları ve ara model aşama aşama gelir', async () => {
    const { service, events } = setup()
    const { gate, open } = gated()
    server.use(...wikimediaHandlers(wmLog, gate)) // özet kaynağı yanıtı bekletir
    const result = service.get(BOHO, 'tr', 'req-1')
    for (let i = 0; i < 50 && !progressOf(events, 'req-1').some((p) => p.stage === 'credits'); i++)
      await settle()

    const atCredits = progressOf(events, 'req-1').find((p) => p.stage === 'credits')!
    expect(atCredits.sections).toEqual({
      match: 'ready',
      credits: 'ready',
      summary: 'pending' // özet henüz gelmedi
    })
    expect(atCredits.done).toBe(false)
    expect(atCredits.data.credits.length).toBeGreaterThan(0) // krediler zaten kullanılabilir
    expect(atCredits.data.artistSummary).toBeNull()
    expect(atCredits.data.match.recording?.mbid).toBe(MBID.recBoho)

    // Geç katılan istek, o ana kadarki aşamaları hemen alır.
    const joined = service.get(BOHO, 'tr', 'req-2')
    expect(progressOf(events, 'req-2').map((p) => p.stage)).toContain('credits')

    open()
    const [res] = await Promise.all([result, joined])
    const stages = progressOf(events, 'req-1')
    expect(stages.map((p) => p.stage).sort()).toEqual(['credits', 'match', 'summary'])
    expect(stages.findIndex((p) => p.stage === 'credits')).toBeLessThan(
      stages.findIndex((p) => p.stage === 'summary')
    )
    const last = stages.at(-1)!
    expect(last.done).toBe(true)
    expect(last.sections.summary).toBe('ready')
    expect(last.data.artistSummary?.lang).toBe('tr')
    expect(stages.every((p) => p.key === res.key)).toBe(true)
    expect(stages.every((p) => TrackBackgroundSchema.safeParse(p.data).success)).toBe(true)
    expect(stages.every((p) => p.atMs >= 0 && p.tookMs >= 0 && p.tookMs <= p.atMs)).toBe(true)
    expect(res).toMatchObject({ complete: true, cached: false })
    expect(res.sections).toEqual(last.sections)
    expect(res.data.artistSummary?.text).toBeTruthy()
  })

  it('requestId yoksa ilerleme bildirilmez; cache’ten gelen sonuç bölüm durumlarını taşır', async () => {
    const { service, events } = setup()
    await service.get(BOHO, 'tr')
    expect(events).toEqual([])
    const cached = await service.get(BOHO, 'tr', 'req-9')
    expect(cached).toMatchObject({
      cached: true,
      complete: true,
      sections: { match: 'ready', credits: 'ready', summary: 'ready' }
    })
    expect(events).toEqual([]) // anında döndü: aşama yok
  })

  it('yarım sonuç cache’e tamamlanmış yazılmaz; eksik bölüm bir sonraki istekte yeniden denenir', async () => {
    const { service } = setup()
    server.use(
      http.get('https://www.wikidata.org/w/api.php', () => new HttpResponse(null, { status: 500 }))
    )
    const first = await service.get(BOHO, 'tr')
    expect(first).toMatchObject({
      complete: false,
      cached: false,
      sections: { match: 'ready', credits: 'ready', summary: 'error' }
    })
    expect(first.data.credits.length).toBeGreaterThan(0) // eldeki veri yine döner
    expect(first.data.artistSummary).toBeNull()
    expect(rows('bg_track')).toBe(0) // tamamlanmış diye yazılmadı

    server.use(...wikimediaHandlers(wmLog)) // kaynak düzeldi
    const mbBefore = mbLog.length
    const second = await service.get(BOHO, 'tr')
    expect(second).toMatchObject({ complete: true, cached: false })
    expect(second.sections.summary).toBe('ready')
    expect(mbLog.length).toBe(mbBefore) // krediler HTTP cache'inden: yeniden istek yok
    expect(rows('bg_track')).toBe(1)
    expect(await service.get(BOHO, 'tr')).toMatchObject({ cached: true, complete: true })
  })

  it('çalan şarkı değişince önceki şarkının isteği iptal edilir; kota harcanmaz, yarım sonuç yazılmaz', async () => {
    // Hurt'ün eşleştirme araması ağda asılı kalır (MusicBrainz yuvasını tutar).
    const hung: URL[] = []
    const { service, events } = setup(hangingFetch((u) => u.pathname === '/ws/2/recording', hung))
    const hurt = service.get(HURT, 'en', 'r-hurt')
    const hurtCheck = expect(hurt).rejects.toMatchObject({ code: 'BG_CANCELLED', id: 'BG_008' })
    await settle()
    expect(hung).toHaveLength(1)

    const boho = await service.get(BOHO, 'tr') // yeni şarkı: Hurt iptal edilir
    await hurtCheck
    expect(boho.complete).toBe(true)
    // Hurt için iptal sonrası hiçbir MusicBrainz isteği atılmadı (kayıt/yayın ayrıntısı yok).
    expect(hung).toHaveLength(1)
    expect(mbLog.map((u) => u.pathname)).not.toContain(`/ws/2/recording/${MBID.recHurt}`)
    expect(mbLog.map((u) => u.pathname)).not.toContain('/ws/2/recording')
    expect(rows('bg_track')).toBe(1) // yalnızca Boho
    expect(progressOf(events, 'r-hurt')).toEqual([]) // eşleştirme bile bitmedi
  })

  it('aynı şarkıyı yeniden istemek iptal etmez; çıkış (clear) sürenleri iptal eder ve yazdırmaz', async () => {
    const { service } = setup(hangingFetch((u) => u.pathname === '/ws/2/recording'))
    const a = service.get(HURT, 'en')
    const b = service.get(HURT, 'en') // aynı şarkı: birleşir, iptal yok
    const checks = Promise.all([
      expect(a).rejects.toMatchObject({ code: 'BG_CANCELLED' }),
      expect(b).rejects.toMatchObject({ code: 'BG_CANCELLED' })
    ])
    await settle()
    service.clear()
    await checks
    await settle()
    expect(rows('bg_track')).toBe(0)
  })

  it('sınırın üzerinde dolan cache sınırın altına iner; son erişilenler korunur', async () => {
    const clock = virtualClock()
    const make = (maxBytes: number) =>
      new BackgroundService({
        db,
        userAgent: TEST_USER_AGENT,
        emit: () => {},
        now: clock.now,
        sleep: clock.sleep,
        cache: { maxBytes, lowWaterRatio: 0.9, sweepEveryWrites: 1_000 }
      })
    const big = make(10_000_000)
    await big.get(BOHO, 'tr')
    const oneTrack = big.cacheMaintenance.totalBytes()
    clock.advance(60_000)
    await big.get(HURT, 'en')
    const both = big.cacheMaintenance.totalBytes()
    expect(both).toBeGreaterThan(oneTrack)

    // Yeniden açılışta sınır ikisinin toplamından küçük: açılış temizliği EN ESKİ satırları siler.
    const newest = (): number =>
      Number(
        (
          db
            .prepare(
              `SELECT (SELECT COUNT(*) FROM bg_http_cache WHERE last_access >= ?)
                    + (SELECT COUNT(*) FROM bg_track WHERE last_access >= ?) AS n`
            )
            .get(clock.now() - 1, clock.now() - 1) as { n: number }
        ).n
      )
    const rowsBefore = rows('bg_http_cache') + rows('bg_match') + rows('bg_track')
    const newestBefore = newest()
    expect(newestBefore).toBeGreaterThan(0)
    const limit = Math.floor(both * 0.8)
    const reopened = make(limit)
    expect(reopened.cacheMaintenance.totalBytes()).toBeLessThanOrEqual(limit)
    expect(rows('bg_http_cache') + rows('bg_match') + rows('bg_track')).toBeLessThan(rowsBefore)
    expect(newest()).toBe(newestBefore) // son erişilenlerin (Hurt) hiçbiri silinmedi
    const requests = mbLog.length + wmLog.length
    expect((await reopened.get(HURT, 'en')).cached).toBe(true)
    expect(mbLog.length + wmLog.length).toBe(requests) // ağa çıkmadan
  })
})
