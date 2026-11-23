import { http, HttpResponse } from 'msw'

// MusicBrainz MSW fixture'ları (yalnızca testler). Yanıt biçimleri MusicBrainz WS/2 JSON'una
// (https://musicbrainz.org/doc/MusicBrainz_API) uygundur; MBID'ler test için uydurulmuştur.

export const MBID = {
  queen: '0383dadf-2a4e-4d10-a46a-e9e041da8eb3',
  freddie: '022589ce-a5f2-4b2b-9a8b-6e1f0b5a1a01',
  brian: '5d6b4d8a-7f0e-4f8b-9d77-2f4a7b9f3b02',
  royBaker: '3b8c4f10-1d6a-4b1a-8e0f-7a2b0c9d1e03',
  mikeStone: '9a0e2c51-6b3d-4c2e-9f1a-0b3c4d5e6f04',
  designer: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e05',
  johnnyCash: '18fa2fd5-3ef2-4496-ba9f-6dae655b2a4f',
  rickRubin: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e06',
  trentReznor: '4d5e6f70-8192-4a3b-bc4d-5e6f7a8b9c07',
  nin: 'b7ffd2af-418f-4be2-bdd1-22f8b48613da',
  morVeOtesi: '6e7f8091-a2b3-4c4d-8e5f-6a7b8c9d0e08',
  recBoho: 'b1a9c0e9-d987-4042-ae91-78d6a3267d69',
  recBohoGh: 'c2b8d1f0-e098-4153-bf02-89e7b4378e70',
  recHurt: 'd3c9e201-f109-4264-8013-9af8c5489f81',
  recHurtLive: 'e4dafa12-0210-4375-9124-ab09d659a092',
  recHurtNin: 'f5eb0b23-1321-4486-a235-bc1ae76ab1a3',
  recDerdim: '06fc1c34-2432-4597-b346-cd2bf87bc2b4',
  relOpera: '17ad2d45-3543-46a8-8457-de3c098cd3c5',
  relGreatest: '28be3e56-4654-47b9-9568-ef4d1a9de4d6',
  relAmerican: '39cf4f67-5765-48ca-a679-f05e2bae5fe7',
  relHurtLive: '4ad05078-6876-49db-b78a-016f3cbf60f8',
  relDerdim: '5be16189-7987-4aec-889b-1270ad0071a9',
  workBoho: '6cf2729a-8a98-4bfd-99ac-2381be1182ba',
  workHurt: '7d0383ab-9ba9-4c0e-aabd-3492cf2293cb',
  rockfield: '8e1494bc-acba-4d1f-bbce-45a3d03304dc',
  akashic: '9f25a5cd-bdcb-4e20-8cdf-56b4e14415ed',
  labelEmi: 'a036b6de-cedc-4f31-9de0-67c5f25526fe',
  labelAmerican: 'b147c7ef-dfed-4042-aef1-78d60363370f'
} as const

const credit = (id: string, name: string, joinphrase = '') => ({
  name,
  joinphrase,
  artist: { id, name, 'sort-name': name, disambiguation: '' }
})

const release = (id: string, title: string, date: string, status = 'Official') => ({
  id,
  title,
  status,
  date,
  country: 'XW',
  'release-events': [{ date }],
  'track-count': 12
})

const artistRel = (
  type: string,
  id: string,
  name: string,
  attributes: string[] = [],
  extra: Record<string, unknown> = {}
) => ({
  type,
  'type-id': '00000000-0000-4000-8000-000000000000',
  'target-type': 'artist',
  direction: 'backward',
  attributes,
  'attribute-values': {},
  begin: null,
  end: null,
  ended: false,
  artist: { id, name, 'sort-name': name, disambiguation: '' },
  ...extra
})

// --- Adaylar (ISRC araması ve kayıt araması) ---------------------------------------------------

export const CANDIDATES = {
  boho: {
    id: MBID.recBoho,
    score: 100,
    title: 'Bohemian Rhapsody',
    length: 354_320,
    video: null,
    'artist-credit': [credit(MBID.queen, 'Queen')],
    releases: [release(MBID.relOpera, 'A Night at the Opera', '1975-11-21')]
  },
  bohoGreatest: {
    id: MBID.recBohoGh,
    score: 100,
    title: 'Bohemian Rhapsody',
    length: 359_900,
    video: null,
    'artist-credit': [credit(MBID.queen, 'Queen')],
    releases: [release(MBID.relGreatest, 'Greatest Hits', '1981-10-26')]
  },
  hurt: {
    id: MBID.recHurt,
    score: 100,
    title: 'Hurt',
    length: 216_973,
    'artist-credit': [credit(MBID.johnnyCash, 'Johnny Cash')],
    releases: [release(MBID.relAmerican, 'American IV: The Man Comes Around', '2002-11-05')]
  },
  hurtLive: {
    id: MBID.recHurtLive,
    score: 100,
    title: 'Hurt',
    length: 260_400,
    'artist-credit': [credit(MBID.johnnyCash, 'Johnny Cash')],
    releases: [release(MBID.relHurtLive, 'Live at Glastonbury', '2003-06-27', 'Bootleg')]
  },
  hurtNin: {
    id: MBID.recHurtNin,
    score: 95,
    title: 'Hurt',
    length: 373_000,
    'artist-credit': [credit(MBID.nin, 'Nine Inch Nails')],
    releases: [release('5a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d', 'The Downward Spiral', '1994-03-08')]
  },
  derdimAkustik: {
    id: MBID.recDerdim,
    score: 88,
    title: 'Bir Derdim Var (akustik)',
    length: 251_000,
    'artist-credit': [credit(MBID.morVeOtesi, 'mor ve ötesi')],
    releases: [release(MBID.relDerdim, 'Akustik Kayıtlar', '2009-01-01')]
  },
  /** Bozuk öğe: MBID yok → atlanmalı. */
  broken: { title: 'Kimliksiz', length: 'uzun' }
}

// --- Kayıt ayrıntıları (3.A3: krediler, eser, stüdyo) -----------------------------------------

const RECORDING_DETAILS: Record<string, unknown> = {
  [MBID.recBoho]: {
    ...CANDIDATES.boho,
    'first-release-date': '1975-10-31',
    disambiguation: '',
    isrcs: ['GBUM71029604'],
    relations: [
      artistRel('producer', MBID.royBaker, 'Roy Thomas Baker'),
      artistRel('producer', MBID.queen, 'Queen'),
      artistRel('engineer', MBID.mikeStone, 'Mike Stone'),
      artistRel('vocal', MBID.freddie, 'Freddie Mercury', ['lead vocals']),
      artistRel('instrument', MBID.brian, 'Brian May', ['guitar']),
      artistRel('instrument', MBID.freddie, 'Freddie Mercury', ['piano']),
      {
        type: 'recorded at',
        'target-type': 'place',
        direction: 'forward',
        attributes: [],
        begin: '1975-08-24',
        end: '1975-09',
        place: { id: MBID.rockfield, name: 'Rockfield Studios', area: { name: 'Monmouth' } }
      },
      {
        type: 'performance',
        'target-type': 'work',
        direction: 'forward',
        attributes: [],
        work: {
          id: MBID.workBoho,
          title: 'Bohemian Rhapsody',
          relations: [
            artistRel('composer', MBID.freddie, 'Freddie Mercury'),
            artistRel('lyricist', MBID.freddie, 'Freddie Mercury'),
            // Bilinmeyen/bozuk ilişki: atlanmalı.
            { type: 'composer', 'target-type': 'artist', artist: { name: 'MBID yok' } }
          ]
        }
      },
      // Kimliksiz ilişki: atlanmalı.
      { type: 'producer', 'target-type': 'artist', artist: { name: 'Sahte' } }
    ]
  },
  [MBID.recHurt]: {
    ...CANDIDATES.hurt,
    'first-release-date': '2002-11-05',
    isrcs: [],
    relations: [
      artistRel('producer', MBID.rickRubin, 'Rick Rubin'),
      {
        type: 'recorded at',
        'target-type': 'place',
        attributes: [],
        place: { id: MBID.akashic, name: 'Akashic Studios' }
      },
      {
        type: 'performance',
        'target-type': 'work',
        attributes: ['cover'],
        work: {
          id: MBID.workHurt,
          title: 'Hurt',
          relations: [artistRel('writer', MBID.trentReznor, 'Trent Reznor')]
        }
      }
    ]
  }
}

const RELEASE_DETAILS: Record<string, unknown> = {
  [MBID.relOpera]: {
    ...release(MBID.relOpera, 'A Night at the Opera', '1975-11-21'),
    country: 'GB',
    'label-info': [
      { 'catalog-number': 'EMTC 103', label: { id: MBID.labelEmi, name: 'EMI' } },
      { 'catalog-number': null, label: { name: 'Kimliksiz label' } }
    ],
    relations: [artistRel('design', MBID.designer, 'David Costa')]
  },
  [MBID.relAmerican]: {
    ...release(MBID.relAmerican, 'American IV: The Man Comes Around', '2002-11-05'),
    'label-info': [
      {
        'catalog-number': '063 339-2',
        label: { id: MBID.labelAmerican, name: 'American Recordings' }
      }
    ],
    relations: []
  }
}

// --- MSW --------------------------------------------------------------------------------------

export interface MbFixtureOptions {
  isrc?: Record<string, unknown[]>
  /** Arama: sorgu bu metni içerirse bu adaylar döner (ilk eşleşen). */
  search?: [contains: string, recordings: unknown[]][]
  recordings?: Record<string, unknown>
  releases?: Record<string, unknown>
}

/** MusicBrainz WS/2 sahte uç noktaları; istekler `log`'a yazılır. */
export function musicBrainzHandlers(options: MbFixtureOptions, log: URL[] = []) {
  const root = 'https://musicbrainz.org/ws/2'
  const record = (request: Request): URL => {
    const url = new URL(request.url)
    log.push(url)
    return url
  }
  return [
    http.get(`${root}/isrc/:isrc`, ({ request, params }) => {
      record(request)
      const recordings = options.isrc?.[String(params.isrc)]
      return recordings
        ? HttpResponse.json({ isrc: params.isrc, recordings })
        : HttpResponse.json({ error: 'Not Found', help: '' }, { status: 404 })
    }),
    http.get(`${root}/recording`, ({ request }) => {
      const query = record(request).searchParams.get('query') ?? ''
      const hit = options.search?.find(([needle]) => query.includes(needle))
      const recordings = hit?.[1] ?? []
      return HttpResponse.json({
        created: '2026-10-01T00:00:00.000Z',
        count: recordings.length,
        offset: 0,
        recordings
      })
    }),
    http.get(`${root}/recording/:mbid`, ({ request, params }) => {
      record(request)
      const body = (options.recordings ?? RECORDING_DETAILS)[String(params.mbid)]
      return body
        ? HttpResponse.json(body)
        : HttpResponse.json({ error: 'Not Found' }, { status: 404 })
    }),
    http.get(`${root}/release/:mbid`, ({ request, params }) => {
      record(request)
      const body = (options.releases ?? RELEASE_DETAILS)[String(params.mbid)]
      return body
        ? HttpResponse.json(body)
        : HttpResponse.json({ error: 'Not Found' }, { status: 404 })
    })
  ]
}
