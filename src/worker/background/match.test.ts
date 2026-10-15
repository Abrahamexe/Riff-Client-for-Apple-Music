import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackRef } from '@shared/background'
import { openDatabase, type Db } from '../db/connection'
import { MemoryResponseCache } from './cache'
import { cleanTitle, durationScore, matchTrack, normalize, pickRelease, similarity } from './match'
import { MatchCache, Matcher, refKey, WEAK_MATCH_TTL_MS } from './matcher'
import { CANDIDATES, MBID, musicBrainzHandlers } from './musicbrainz.fixtures'
import { createSourceClient } from './sources/factory'
import { escapeLucene, MusicBrainzSource } from './sources/musicbrainz'
import { TEST_USER_AGENT, useMswServer, virtualClock } from './testing'

const server = useMswServer()
const requests: URL[] = []
const dbs: Db[] = []

beforeEach(() => {
  requests.length = 0
  server.use(
    ...musicBrainzHandlers(
      {
        isrc: { GBUM71029604: [CANDIDATES.bohoGreatest, CANDIDATES.boho, CANDIDATES.broken] },
        search: [
          ['Bohemian', [CANDIDATES.boho, CANDIDATES.bohoGreatest]],
          ['Derdim', [CANDIDATES.derdimAkustik]],
          ['Hurt', [CANDIDATES.hurtLive, CANDIDATES.hurtNin, CANDIDATES.hurt]]
        ]
      },
      requests
    )
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of dbs.splice(0)) db.close()
})

function mb(clock = virtualClock()) {
  return new MusicBrainzSource(
    createSourceClient('musicbrainz', {
      userAgent: TEST_USER_AGENT,
      cache: new MemoryResponseCache(),
      now: clock.now,
      sleep: clock.sleep
    })
  )
}

const BOHO: TrackRef = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night At The Opera (2011 Remaster)',
  isrc: 'GBUM71029604',
  durationMs: 354_947
}

describe('metin benzerliği', () => {
  it('aksan, büyük/küçük harf ve noktalama farkı benzerliği bozmaz', () => {
    expect(normalize('Beyoncé — Halo!')).toBe('beyonce halo')
    expect(similarity('mor ve ÖTESİ', 'Mor ve Ötesi')).toBe(1)
    expect(similarity('Gül Pembe', 'Gülpembe')).toBe(1)
    expect(similarity('Hurt', 'Yesterday')).toBeLessThan(0.2)
  })

  it('başlıktaki remaster/feat ekleri temizlenir', () => {
    expect(cleanTitle('Bohemian Rhapsody - Remastered 2011')).toBe('Bohemian Rhapsody')
    expect(cleanTitle('Señorita (feat. Camila Cabello)')).toBe('Señorita')
    expect(cleanTitle('Song [Radio Edit]')).toBe('Song')
    expect(cleanTitle('(Live)')).toBe('(Live)')
  })

  it('süre toleransı: ±3 sn tam puan, 20 sn üstü elenir', () => {
    expect(durationScore(200_000, 202_900)).toBe(1)
    expect(durationScore(200_000, 210_000)).toBeCloseTo(0.5)
    expect(durationScore(200_000, 220_000)).toBe(0)
    expect(durationScore(200_000, 220_001)).toBeNull()
  })

  it('yayın seçimi: albüm benzerliği, resmi yayın, tam tarihli en eski', () => {
    const r = (id: string, title: string, date: string, status = 'Official') => ({
      id,
      title,
      date,
      status
    })
    const releases = [
      r('a', 'A Night at the Opera', '1975'),
      r('b', 'A Night at the Opera', '1975-11-21'),
      r('c', 'Greatest Hits', '1974-01-01'),
      r('d', 'A Night at the Opera', '1975-01-01', 'Bootleg')
    ]
    expect(pickRelease(releases, 'A Night At The Opera (2011 Remaster)')?.id).toBe('b')
    expect(pickRelease(releases)?.id).toBe('c')
    expect(pickRelease([])).toBeNull()
  })

  it('Lucene özel karakterleri kaçırılır', () => {
    expect(escapeLucene('AC/DC: "Back" (in) Black?')).toBe(
      'AC\\/DC\\: \\"Back\\" \\(in\\) Black\\?'
    )
  })
})

describe('matchTrack (3.A2)', () => {
  it('ISRC ile doğru kayıt seçilir: süresi en yakın ve albümü tutan; tek istek yeter', async () => {
    const match = await matchTrack(BOHO, mb())
    expect(match).toMatchObject({
      status: 'matched',
      method: 'isrc',
      recording: { mbid: MBID.recBoho, artistCredit: 'Queen', artists: [{ mbid: MBID.queen }] },
      release: { mbid: MBID.relOpera, title: 'A Night at the Opera', date: '1975-11-21' }
    })
    expect(match.confidence).toBeGreaterThanOrEqual(0.85)
    expect(requests.map((u) => u.pathname)).toEqual(['/ws/2/isrc/GBUM71029604'])
    expect(requests[0]!.searchParams.get('fmt')).toBe('json')
  })

  it('ISRC MusicBrainz’de yoksa başlık + sanatçı aramasına düşer', async () => {
    const match = await matchTrack({ ...BOHO, isrc: 'USXXX0000001' }, mb())
    expect(match).toMatchObject({ status: 'matched', method: 'search' })
    expect(match.recording?.mbid).toBe(MBID.recBoho)
    expect(requests.map((u) => u.pathname)).toEqual(['/ws/2/isrc/USXXX0000001', '/ws/2/recording'])
    const query = requests[1]!.searchParams.get('query')!
    expect(query).toBe('recording:"Bohemian Rhapsody" AND artist:"Queen"')
  })

  it('aynı adlı farklı şarkılar: süre toleransı ve sanatçı yanlış eşleşmeyi engeller', async () => {
    const ref: TrackRef = { title: 'Hurt', artist: 'Johnny Cash', durationMs: 218_000 }
    const match = await matchTrack(ref, mb())
    // Canlı kayıt (260 sn) ve Nine Inch Nails kaydı değil, stüdyo kaydı.
    expect(match.recording?.mbid).toBe(MBID.recHurt)
    expect(match.status).toBe('matched')
  })

  it('yalnızca süresi çok farklı aday varsa eşleşme YOK (cover/canlı yanlışlıkla seçilmez)', async () => {
    server.use(...musicBrainzHandlers({ search: [['Hurt', [CANDIDATES.hurtLive]]] }, requests))
    const match = await matchTrack(
      { title: 'Hurt', artist: 'Johnny Cash', durationMs: 218_000 },
      mb()
    )
    expect(match).toEqual({
      status: 'none',
      confidence: 0,
      method: null,
      recording: null,
      release: null
    })
  })

  it('düşük güven "belirsiz" olarak işaretlenir (kesin gibi gösterilmez)', async () => {
    const match = await matchTrack({ title: 'Bir Derdim Var', artist: 'mor ve ötesi' }, mb())
    expect(match.status).toBe('uncertain')
    expect(match.confidence).toBeGreaterThanOrEqual(0.6)
    expect(match.confidence).toBeLessThan(0.85)
    expect(match.recording?.mbid).toBe(MBID.recDerdim)
  })

  it('hiç aday yoksa none; bozuk aday (MBID yok) atlanır', async () => {
    const match = await matchTrack({ title: 'Bilinmeyen Şarkı', artist: 'Kimse' }, mb())
    expect(match.status).toBe('none')
  })
})

describe('Matcher: eşleşme cache’i (3.A2)', () => {
  it('eşleşme SQLite’a yazılır; ikinci çağrı ağa çıkmaz; anahtar şarkı adını açık içermez', async () => {
    const db = openDatabase(':memory:')
    dbs.push(db)
    const clock = virtualClock()
    const matcher = new Matcher(mb(clock), new MatchCache(db), clock.now)
    const first = await matcher.match(BOHO)
    const count = requests.length
    expect(await matcher.match(BOHO)).toEqual(first)
    expect(requests).toHaveLength(count)

    const key = refKey(BOHO)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    const row = db.prepare('SELECT ref_key FROM bg_match').get() as { ref_key: string }
    expect(row.ref_key).toBe(key)
    // Aynı şarkı, ms farkıyla (saniyeye yuvarlanır) aynı anahtar.
    expect(refKey({ ...BOHO, durationMs: 354_700 })).toBe(key)
  })

  it('belirsiz sonuç 1 gün sonra yeniden denenir; ağ yoksa eski sonuç kullanılır', async () => {
    const clock = virtualClock()
    const db = openDatabase(':memory:')
    dbs.push(db)
    const cache = new MatchCache(db)
    const ref = { title: 'Bir Derdim Var', artist: 'mor ve ötesi' }
    await new Matcher(mb(clock), cache, clock.now).match(ref)
    const before = requests.length
    clock.advance(WEAK_MATCH_TTL_MS)
    // Yeni süreç gibi: HTTP cache'i boş, ağ yok.
    server.use(http.get('https://musicbrainz.org/*', () => HttpResponse.error()))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const again = await new Matcher(mb(clock), cache, clock.now).match(ref)
    expect(again.status).toBe('uncertain')
    expect(requests.length).toBe(before)
  })
})
