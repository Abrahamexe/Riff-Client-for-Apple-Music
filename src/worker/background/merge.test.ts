import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackBackgroundSchema, type Credit, type TrackRef } from '@shared/background'
import { fetchArtistSummary } from './artistSummary'
import { MemoryResponseCache } from './cache'
import { fetchMusicBrainzBackground } from './credits'
import { matchTrack } from './match'
import { mergeBackground, type BackgroundParts } from './merge'
import { CANDIDATES, MBID, musicBrainzHandlers } from './musicbrainz.fixtures'
import { createSourceClient } from './sources/factory'
import { MusicBrainzSource } from './sources/musicbrainz'
import { inspectWikimediaBody, WikimediaSource } from './sources/wikimedia'
import { TEST_USER_AGENT, useMswServer, virtualClock } from './testing'
import { wikimediaHandlers } from './wikimedia.fixtures'

const server = useMswServer()
beforeEach(() => {
  server.use(
    ...musicBrainzHandlers({ isrc: { GBUM71029604: [CANDIDATES.boho] } }),
    ...wikimediaHandlers()
  )
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

const BOHO: TrackRef = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  isrc: 'GBUM71029604',
  durationMs: 354_947
}
const NOW = 1_800_000_000_000

/** Fixture'lardan gerçek boru hattıyla parçaları üretir. */
async function parts(): Promise<BackgroundParts> {
  const clock = virtualClock(NOW)
  const deps = {
    userAgent: TEST_USER_AGENT,
    cache: new MemoryResponseCache(),
    now: clock.now,
    sleep: clock.sleep
  }
  const mb = new MusicBrainzSource(createSourceClient('musicbrainz', deps))
  const wm = new WikimediaSource(
    createSourceClient('wikimedia', deps, { inspectBody: inspectWikimediaBody })
  )
  const match = await matchTrack(BOHO, mb)
  return {
    match,
    musicbrainz: await fetchMusicBrainzBackground(match, mb),
    summary: await fetchArtistSummary({ mbid: MBID.queen, name: 'Queen' }, 'tr', wm),
    now: clock.now()
  }
}

const names = (credits: Credit[]) => credits.map((c) => `${c.role}:${c.name}:${c.source}`)

describe('birleşik model (3.A6)', () => {
  it('MusicBrainz + Wikidata/Wikipedia ile tam sonuç; şemaya uyar', async () => {
    const bg = mergeBackground(await parts())
    expect(TrackBackgroundSchema.safeParse(bg).success).toBe(true)
    expect(bg.match.status).toBe('matched')
    expect(names(bg.credits)).toContain('producer:Roy Thomas Baker:musicbrainz')
    expect(names(bg.work.composers)).toEqual(['composer:Freddie Mercury:musicbrainz'])
    expect(names(bg.work.lyricists)).toEqual(['lyricist:Freddie Mercury:musicbrainz'])
    expect(bg.recording).toMatchObject({
      recordedDate: { value: '1975-08-24', source: 'musicbrainz' },
      releaseDate: { value: '1975-11-21', source: 'musicbrainz' },
      releaseTitle: { value: 'A Night at the Opera', source: 'musicbrainz' },
      studios: [{ name: 'Rockfield Studios', source: 'musicbrainz' }],
      labels: [{ name: 'EMI', source: 'musicbrainz' }]
    })
    expect(bg.artistSummary).toMatchObject({
      lang: 'tr',
      license: 'CC BY-SA 4.0',
      source: 'wikipedia'
    })
    expect(bg.sources.map((s) => s.source)).toEqual(['musicbrainz', 'wikidata', 'wikipedia'])
  })

  it('eşleşme yoksa boş ama geçerli model (yanlış veri uydurulmaz)', () => {
    const bg = mergeBackground({
      match: { status: 'none', confidence: 0, method: null, recording: null, release: null },
      musicbrainz: null,
      summary: null,
      now: NOW
    })
    expect(TrackBackgroundSchema.safeParse(bg).success).toBe(true)
    expect(bg.credits).toEqual([])
    expect(bg.sources).toEqual([])
  })
})
