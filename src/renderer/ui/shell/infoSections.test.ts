import { describe, expect, it } from 'vitest'
import { TrackBackgroundSchema, type Credit, type TrackBackground } from '@shared/background'
import { creditGroups, hasAnyInfo, recordingRows } from './infoSections'

const MBID = '056e4f3e-d505-4dad-8ec1-d04f521cbb56'

function bg(over: Partial<TrackBackground> = {}): TrackBackground {
  const base: TrackBackground = {
    version: 4,
    match: { status: 'matched', confidence: 1, method: 'isrc', recording: null, release: null },
    credits: [],
    recording: {
      recordedDate: null,
      releaseDate: null,
      releaseTitle: null,
      studios: [],
      labels: []
    },
    work: { works: [], composers: [], lyricists: [], writers: [] },
    samples: { samples: [], sampledBy: [] },
    artistSummary: null,
    sources: [],
    fetchedAt: 0
  }
  const out = { ...base, ...over }
  expect(TrackBackgroundSchema.safeParse(out).success).toBe(true)
  return out
}

const credit = (over: Partial<Credit>): Credit => ({
  role: 'producer',
  rawRole: 'producer',
  name: 'Kanye West',
  mbid: null,
  attributes: [],
  scope: 'recording',
  source: 'musicbrainz',
  ...over
})

describe('bilgi paneli bölümleri (§3.5)', () => {
  it('krediler gruplanır; aynı kişi bir kez, rolleri ve ayrıntıları birleşir; sıra sabit', () => {
    const groups = creditGroups(
      bg({
        credits: [
          credit({ role: 'producer', name: 'Kanye West' }),
          credit({
            role: 'instrument',
            name: 'Daft Punk',
            mbid: MBID,
            attributes: ['synthesizer']
          }),
          credit({
            role: 'vocal',
            name: 'Daft Punk',
            mbid: MBID,
            attributes: ['background vocals']
          }),
          credit({ role: 'mix', name: 'Manny Marroquin' })
        ],
        work: {
          works: [],
          composers: [credit({ role: 'composer', name: 'Kanye West', scope: 'work' })],
          lyricists: [credit({ role: 'lyricist', name: 'kanye west', scope: 'work' })],
          writers: []
        }
      })
    )
    expect(groups.map((g) => g.key)).toEqual(['writers', 'producers', 'performers', 'engineering'])
    expect(groups[0]!.people).toEqual([
      { name: 'Kanye West', roles: ['info.role.composer', 'info.role.lyricist'], detail: null }
    ])
    expect(groups[2]!.people).toEqual([
      {
        name: 'Daft Punk',
        roles: ['info.role.instrument', 'info.role.vocal'],
        detail: 'synthesizer, background vocals'
      }
    ])
  })

  it('kayıt satırları yalnızca dolu alanlardan; stüdyo ve şirket tekrarsız', () => {
    const studio = {
      name: 'Avex Recording Studio',
      mbid: null,
      area: null,
      rawRole: 'recorded at',
      begin: null,
      end: null,
      source: 'musicbrainz' as const
    }
    const rows = recordingRows(
      bg({
        recording: {
          recordedDate: null,
          releaseDate: { value: '2007-09-11', source: 'musicbrainz' },
          releaseTitle: { value: 'Graduation', source: 'musicbrainz' },
          studios: [studio, studio],
          labels: [{ name: 'Roc-A-Fella', mbid: null, catalogNumber: null, source: 'musicbrainz' }]
        }
      })
    )
    expect(rows).toEqual([
      { label: 'info.release', value: 'Graduation' },
      { label: 'info.releaseDate', value: '2007-09-11' },
      { label: 'info.studio', value: 'Avex Recording Studio' },
      { label: 'info.label', value: 'Roc-A-Fella' }
    ])
  })

  it('hiçbir bölüm yoksa "bulunamadı"; yalnızca sample bile yeter', () => {
    expect(hasAnyInfo(bg())).toBe(false)
    expect(
      hasAnyInfo(
        bg({
          samples: {
            samples: [{ title: 'Harder', artist: 'Daft Punk', mbid: MBID, source: 'musicbrainz' }],
            sampledBy: []
          }
        })
      )
    ).toBe(true)
  })
})
