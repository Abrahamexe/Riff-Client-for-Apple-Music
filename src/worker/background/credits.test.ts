import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreditSchema, LabelSchema, StudioSchema, type Match } from '@shared/background'
import { MemoryResponseCache } from './cache'
import { fetchMusicBrainzBackground, roleOf, sampleRefs, samplesWithVersions } from './credits'
import { CANDIDATES, MBID, musicBrainzHandlers } from './musicbrainz.fixtures'
import { createSourceClient } from './sources/factory'
import {
  MusicBrainzSource,
  parseRelations,
  RECORDING_INC,
  RELEASE_INC
} from './sources/musicbrainz'
import { TEST_USER_AGENT, useMswServer, virtualClock } from './testing'

const server = useMswServer()
const requests: URL[] = []

beforeEach(() => {
  requests.length = 0
  server.use(...musicBrainzHandlers({}, requests))
})

function mb() {
  const clock = virtualClock()
  return new MusicBrainzSource(
    createSourceClient('musicbrainz', {
      userAgent: TEST_USER_AGENT,
      cache: new MemoryResponseCache(),
      now: clock.now,
      sleep: clock.sleep
    })
  )
}

const match = (recording: string, release: string | null): Match => ({
  status: 'matched',
  confidence: 1,
  method: 'isrc',
  recording: { mbid: recording, title: 'x', lengthMs: null, artistCredit: 'x', artists: [] },
  release: release ? { mbid: release, title: 'x', date: null } : null
})

describe('MusicBrainz verisi (3.A3)', () => {
  it('krediler roller ve kaynak bilgisiyle eksiksiz çıkar (kayıt, eser, yayın düzeyi)', async () => {
    const bg = (await fetchMusicBrainzBackground(match(MBID.recBoho, MBID.relOpera), mb()))!
    const summary = bg.credits.map(
      (c) => `${c.scope}:${c.role}:${c.name}:${c.attributes.join('/')}`
    )
    expect(summary).toEqual([
      'recording:producer:Roy Thomas Baker:',
      'recording:producer:Queen:',
      'recording:engineer:Mike Stone:',
      'recording:vocal:Freddie Mercury:lead vocals',
      'recording:instrument:Brian May:guitar',
      'recording:instrument:Freddie Mercury:piano',
      'work:composer:Freddie Mercury:',
      'work:lyricist:Freddie Mercury:',
      'release:design:David Costa:'
    ])
    for (const c of bg.credits) {
      expect(CreditSchema.safeParse(c).success).toBe(true)
      expect(c.source).toBe('musicbrainz')
      expect(c.mbid).toMatch(/^[0-9a-f-]{36}$/)
    }
    // Kimliksiz/bozuk ilişkiler atlandı.
    expect(summary.join()).not.toMatch(/Sahte|MBID yok/)
  })

  it('stüdyo, kayıt tarihleri, eser, label ve çıkış tarihi gelir', async () => {
    const bg = (await fetchMusicBrainzBackground(match(MBID.recBoho, MBID.relOpera), mb()))!
    expect(bg.studios).toEqual([
      {
        name: 'Rockfield Studios',
        mbid: MBID.rockfield,
        area: 'Monmouth',
        rawRole: 'recorded at',
        begin: '1975-08-24',
        end: '1975-09',
        source: 'musicbrainz'
      }
    ])
    expect(StudioSchema.safeParse(bg.studios[0]).success).toBe(true)
    expect(bg.works).toEqual([
      { title: 'Bohemian Rhapsody', mbid: MBID.workBoho, source: 'musicbrainz' }
    ])
    expect(bg.recording).toMatchObject({
      mbid: MBID.recBoho,
      firstReleaseDate: '1975-10-31',
      isrcs: ['GBUM71029604'],
      url: `https://musicbrainz.org/recording/${MBID.recBoho}`
    })
    expect(bg.release).toMatchObject({
      mbid: MBID.relOpera,
      date: '1975-11-21',
      country: 'GB',
      labels: [
        { name: 'EMI', mbid: MBID.labelEmi, catalogNumber: 'EMTC 103', source: 'musicbrainz' }
      ]
    })
    expect(LabelSchema.safeParse(bg.release!.labels[0]).success).toBe(true)
  })

  it('istek sayısı en az: kayıt + yayın (2 istek), doğrulanmış inc değerleriyle', async () => {
    await fetchMusicBrainzBackground(match(MBID.recBoho, MBID.relOpera), mb())
    expect(requests.map((u) => u.pathname)).toEqual([
      `/ws/2/recording/${MBID.recBoho}`,
      `/ws/2/release/${MBID.relOpera}`
    ])
    expect(requests[0]!.searchParams.get('inc')).toBe(RECORDING_INC)
    expect(RECORDING_INC.split('+')).toEqual(
      expect.arrayContaining(['artist-rels', 'work-rels', 'work-level-rels', 'place-rels'])
    )
    expect(requests[1]!.searchParams.get('inc')).toBe(RELEASE_INC)
  })

  it('cover: eserin yazarı (writer) kayıt sanatçısından ayrı gelir', async () => {
    const bg = (await fetchMusicBrainzBackground(match(MBID.recHurt, null), mb()))!
    expect(bg.credits.filter((c) => c.scope === 'work')).toMatchObject([
      { role: 'writer', name: 'Trent Reznor' }
    ])
    expect(bg.credits.find((c) => c.role === 'producer')?.name).toBe('Rick Rubin')
    // Eşleşmede yayın yok: kayıt ayrıntısındaki tek yayın seçildi.
    expect(bg.release).toMatchObject({ labels: [{ name: 'American Recordings' }] })
  })

  it('eşleşme yoksa istek atılmaz; kayıt silinmişse (404) null', async () => {
    const none: Match = { ...match(MBID.recBoho, null), status: 'none', recording: null }
    expect(await fetchMusicBrainzBackground(none, mb())).toBeNull()
    expect(requests).toHaveLength(0)
    expect(await fetchMusicBrainzBackground(match(CANDIDATES.hurtNin.id, null), mb())).toBeNull()
  })

  it('rol eşlemesi: bilinmeyen ilişki "other" olur, ham adı korunur', () => {
    expect(roleOf('Producer')).toBe('producer')
    expect(roleOf('librettist')).toBe('lyricist')
    expect(roleOf('phonographic copyright')).toBe('other')
  })
})

describe('yayın seçimi (duman testi bulgusu)', () => {
  it('eşleşmede yayın yoksa kayıt ayrıntısındaki yayınlardan seçilir', async () => {
    const bg = (await fetchMusicBrainzBackground(
      match(MBID.recBoho, null),
      mb(),
      { priority: 'user' },
      'A Night at the Opera'
    ))!
    expect(bg.release).toMatchObject({ mbid: MBID.relOpera, labels: [{ name: 'EMI' }] })
    expect(requests.map((u) => u.pathname)).toEqual([
      `/ws/2/recording/${MBID.recBoho}`,
      `/ws/2/release/${MBID.relOpera}`
    ])
  })
})

describe('sample ilişkileri (2026-10-14)', () => {
  const DAFT = 'f1a6a40f-78f5-4918-968d-f64363bae94c'
  const MOUTH = '77034d67-3b32-4b43-87b8-155ab2a1a4d0'
  // Gerçek MusicBrainz yanıtının biçimi (Kanye West "Stronger", inc=recording-rels+artist-credits).
  const raw = [
    {
      type: 'samples material',
      'target-type': 'recording',
      direction: 'forward',
      attributes: [],
      recording: {
        id: DAFT,
        title: 'Harder, Better, Faster, Stronger',
        'artist-credit': [
          { name: 'Daft Punk', joinphrase: '', artist: { id: DAFT, name: 'Daft Punk' } }
        ]
      }
    },
    {
      type: 'samples material',
      'target-type': 'recording',
      direction: 'backward',
      attributes: [],
      recording: {
        id: MOUTH,
        title: 'Daft Mouth',
        'artist-credit': [
          { name: 'Neil Cicierega', joinphrase: ' & ' },
          { name: 'Başka', joinphrase: '' }
        ]
      }
    },
    // Aynı kayıt ikinci kez ve sample olmayan ilişki: alınmaz.
    {
      type: 'samples material',
      'target-type': 'recording',
      direction: 'forward',
      recording: { id: DAFT, title: 'x', 'artist-credit': [] }
    },
    {
      type: 'mashes up',
      'target-type': 'recording',
      direction: 'backward',
      recording: { id: MOUTH, title: 'y', 'artist-credit': [] }
    },
    // Bozuk kimlik: ilişki atılır.
    { type: 'samples material', 'target-type': 'recording', recording: { id: 'bozuk', title: 'z' } }
  ]

  it('kayıtta sample yoksa "edit" ile bağlı kaydınkiler (tek ek istek); varsa ek istek yok', async () => {
    const CLEAN = '040cc48d-ad1a-469f-b1f4-1fcec9525d15'
    const ORIG = '96266690-11b1-48bc-a90c-09d5a0f60611'
    const edit = [
      {
        type: 'edit',
        'target-type': 'recording',
        direction: 'backward',
        recording: { id: ORIG, title: 'Stronger', 'artist-credit': [] }
      }
    ]
    const recording = vi.fn(async (id: string) => ({
      data: id === ORIG ? { relations: parseRelations(raw) } : null
    }))
    const mbFake = { recording } as never
    const viaEdit = await samplesWithVersions(parseRelations(edit), mbFake, {})
    expect(viaEdit.samples.map((x) => x.mbid)).toEqual([DAFT])
    expect(recording).toHaveBeenCalledWith(ORIG, {})
    recording.mockClear()
    const own = await samplesWithVersions(parseRelations(raw), mbFake, {})
    expect(own.samples).toHaveLength(1)
    expect(recording).not.toHaveBeenCalled()
    expect(await samplesWithVersions([], mbFake, {})).toEqual({ samples: [], sampledBy: [] })
    void CLEAN
  })

  it('kayıt sorgusu recording-rels ister', () => {
    expect(RECORDING_INC.split('+')).toContain('recording-rels')
  })

  it('ileri yön = kullandığı, geri yön = kullananlar; sanatçı kredisi birleşir; tekrar ve diğer türler atılır', () => {
    expect(sampleRefs(parseRelations(raw))).toEqual({
      samples: [
        {
          title: 'Harder, Better, Faster, Stronger',
          artist: 'Daft Punk',
          mbid: DAFT,
          source: 'musicbrainz'
        }
      ],
      sampledBy: [
        {
          title: 'Daft Mouth',
          artist: 'Neil Cicierega & Başka',
          mbid: MOUTH,
          source: 'musicbrainz'
        }
      ]
    })
  })
})
