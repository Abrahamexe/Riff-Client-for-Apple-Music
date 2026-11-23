import type {
  ArtistSummary,
  BackgroundSource,
  Match,
  SourceEntry,
  Sourced,
  TrackBackground
} from '@shared/background'
import type { MusicBrainzBackground } from './credits'

// Kaynakların birleştirilmesi (PLAN 3.A6; R3'te Discogs/Last.fm kaldırıldı). Krediler, kayıt ve eser
// bilgisi MusicBrainz'den, sanatçı özeti Wikidata/Wikipedia'dan. Her öğe/alan kaynağını taşır; kaynak
// listesi atıf ve alınma zamanıyla birlikte döner (docs/BACKGROUND.md).

export interface BackgroundParts {
  match: Match
  musicbrainz: MusicBrainzBackground | null
  summary: ArtistSummary | null
  now: number
}

/** Öncelik sırasıyla ilk dolu değer. */
function first<T>(...candidates: (Sourced<T> | null)[]): Sourced<T> | null {
  return candidates.find((c) => c !== null) ?? null
}
const from = <T>(value: T | null | undefined, source: BackgroundSource): Sourced<T> | null =>
  value === null || value === undefined || value === '' ? null : { value, source }

export function mergeBackground(parts: BackgroundParts): TrackBackground {
  const { match, musicbrainz: mb, summary } = parts
  const mbCredits = mb?.credits ?? []
  const workCredits = mbCredits.filter((c) => c.scope === 'work')

  const recordedDate =
    mb?.studios
      .filter((s) => s.rawRole === 'recorded at' && s.begin)
      .map((s) => s.begin!)
      .sort()[0] ?? null

  const sources: SourceEntry[] = []
  if (mb) {
    sources.push({
      source: 'musicbrainz',
      url: mb.recording.url,
      attribution: 'MusicBrainz',
      license: 'CC0',
      fetchedAt: mb.fetchedAt
    })
  }
  if (summary) {
    sources.push(
      {
        source: 'wikidata',
        url: summary.wikidataUrl,
        attribution: 'Wikidata',
        license: 'CC0',
        fetchedAt: summary.fetchedAt
      },
      {
        source: 'wikipedia',
        url: summary.url,
        attribution: `Wikipedia: ${summary.title}`,
        license: summary.license,
        fetchedAt: summary.fetchedAt
      }
    )
  }

  return {
    version: 4,
    match,
    credits: mbCredits.filter((c) => c.scope !== 'work'),
    recording: {
      recordedDate: from(recordedDate, 'musicbrainz'),
      releaseDate: first(
        from(mb?.release?.date, 'musicbrainz'),
        from(mb?.recording.firstReleaseDate, 'musicbrainz')
      ),
      releaseTitle: from(mb?.release?.title, 'musicbrainz'),
      studios: mb?.studios ?? [],
      labels: mb?.release?.labels ?? []
    },
    work: {
      works: mb?.works ?? [],
      composers: workCredits.filter((c) => c.role === 'composer'),
      lyricists: workCredits.filter((c) => c.role === 'lyricist'),
      writers: workCredits.filter((c) => c.role === 'writer')
    },
    samples: mb?.samples ?? { samples: [], sampledBy: [] },
    artistSummary: summary,
    sources,
    fetchedAt: parts.now
  }
}
