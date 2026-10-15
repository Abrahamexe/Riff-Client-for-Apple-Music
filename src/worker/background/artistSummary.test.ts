import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtistSummarySchema } from '@shared/background'
import { fetchArtistSummary, languageOrder } from './artistSummary'
import { MemoryResponseCache } from './cache'
import { MBID } from './musicbrainz.fixtures'
import { createSourceClient } from './sources/factory'
import { inspectWikimediaBody, WikimediaSource } from './sources/wikimedia'
import { TEST_USER_AGENT, useMswServer, virtualClock } from './testing'
import { QID, wikimediaHandlers } from './wikimedia.fixtures'

const server = useMswServer()
const requests: URL[] = []
beforeEach(() => {
  requests.length = 0
  server.use(...wikimediaHandlers(requests))
})

function wm(clock = virtualClock()) {
  return new WikimediaSource(
    createSourceClient(
      'wikimedia',
      {
        userAgent: TEST_USER_AGENT,
        cache: new MemoryResponseCache(),
        now: clock.now,
        sleep: clock.sleep
      },
      { inspectBody: inspectWikimediaBody }
    )
  )
}

const QUEEN = { mbid: MBID.queen, name: 'Queen' }

describe('Wikidata / Wikipedia (3.A4)', () => {
  it('sanatçı özeti kullanıcı dilinde (tr) gelir; kaynak ve lisans alanları dolu', async () => {
    const s = (await fetchArtistSummary(QUEEN, 'tr', wm()))!
    expect(ArtistSummarySchema.safeParse(s).success).toBe(true)
    expect(s).toMatchObject({
      artistMbid: MBID.queen,
      wikidataId: QID.queen,
      wikidataUrl: 'https://www.wikidata.org/wiki/Q15862',
      lang: 'tr',
      title: 'Queen (müzik grubu)',
      url: 'https://tr.wikipedia.org/wiki/Queen_(m%C3%BCzik_grubu)',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source: 'wikipedia'
    })
    // Düz metin: HTML etiketleri ve varlıklar temizlendi.
    expect(s.text).toBe('Queen, 1970 yılında Londra’da kurulan İngiliz rock grubudur. Kalın & düz.')
  })

  it('kullanıcı dilinde sayfa yoksa İngilizceye düşer', async () => {
    const s = (await fetchArtistSummary(
      { mbid: MBID.johnnyCash, name: 'Johnny Cash' },
      'tr',
      wm()
    ))!
    expect(s).toMatchObject({ lang: 'en', title: 'Johnny Cash', license: 'CC BY-SA 4.0' })
    expect(s.url).toBe('https://en.wikipedia.org/wiki/Johnny_Cash')
  })

  it('İngilizce tercihte doğrudan en; tr sayfası istenmez', async () => {
    const s = (await fetchArtistSummary(QUEEN, 'en', wm()))!
    expect(s.lang).toBe('en')
    expect(requests.some((u) => u.hostname === 'tr.wikipedia.org')).toBe(false)
    expect(languageOrder('tr')).toEqual(['tr', 'en'])
  })

  it('Wikidata eşlemesi P434 ile; sitelinks yalnızca istenen diller', async () => {
    await fetchArtistSummary(QUEEN, 'tr', wm())
    const [search, entities, page] = requests
    expect(search!.searchParams.get('srsearch')).toBe(`haswbstatement:P434=${MBID.queen}`)
    expect(entities!.searchParams.get('action')).toBe('wbgetentities')
    expect(entities!.searchParams.get('sitefilter')).toBe('trwiki|enwiki')
    expect(page!.pathname).toBe('/api/rest_v1/page/summary/Queen_(m%C3%BCzik_grubu)')
    expect(requests).toHaveLength(3)
  })

  it('Wikidata öğesi yoksa veya yalnızca anlam ayrımı sayfası varsa null', async () => {
    expect(
      await fetchArtistSummary({ mbid: MBID.morVeOtesi, name: 'mor ve ötesi' }, 'tr', wm())
    ).toBeNull()
    expect(
      await fetchArtistSummary({ mbid: MBID.nin, name: 'Nine Inch Nails' }, 'en', wm())
    ).toBeNull()
  })

  it('Action API gövdesindeki maxlag hatası hız sınırı sayılır ve geri çekilinir', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    server.use(
      http.get('https://www.wikidata.org/w/api.php', () =>
        ++calls === 1
          ? HttpResponse.json({ error: { code: 'maxlag', info: 'Waiting for db' } })
          : HttpResponse.json({ query: { search: [{ title: QID.queen }] } })
      )
    )
    expect(await wm().itemForArtist(MBID.queen)).toBe(QID.queen)
    expect(calls).toBe(2)
    expect(inspectWikimediaBody({ error: { code: 'badtoken' } })?.code).toBe('BG_REQUEST_FAILED')
    expect(inspectWikimediaBody({ query: {} })).toBeNull()
  })
})
