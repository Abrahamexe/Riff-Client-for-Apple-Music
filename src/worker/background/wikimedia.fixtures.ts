import { http, HttpResponse } from 'msw'
import { MBID } from './musicbrainz.fixtures'

// Wikidata (Action API) ve Wikipedia (REST page/summary) MSW fixture'ları (yalnızca testler).
// Biçimler gerçek yanıtlara uygundur; metinler kısaltılmıştır.

export const QID = { queen: 'Q15862', cash: 'Q42775', nin: 'Q11647' } as const

/** P434 (MusicBrainz artist ID) → Wikidata öğesi. */
const ITEM_BY_MBID: Record<string, string> = {
  [MBID.queen]: QID.queen,
  [MBID.johnnyCash]: QID.cash,
  [MBID.nin]: QID.nin
}

const SITELINKS: Record<string, Record<string, string>> = {
  [QID.queen]: { trwiki: 'Queen (müzik grubu)', enwiki: 'Queen (band)' },
  [QID.cash]: { enwiki: 'Johnny Cash' },
  // Yalnızca anlam ayrımı sayfası var (özet olarak kullanılmamalı).
  [QID.nin]: { enwiki: 'NIN' }
}

const summary = (lang: string, title: string, extract: string, type = 'standard') => ({
  type,
  title,
  displaytitle: `<span class="mw-page-title-main">${title}</span>`,
  wikibase_item: 'Q0',
  lang,
  dir: 'ltr',
  description: 'açıklama',
  extract,
  extract_html: `<p>${extract}</p>`,
  content_urls: {
    desktop: {
      page: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    },
    mobile: { page: `https://${lang}.m.wikipedia.org/wiki/x` }
  }
})

const SUMMARIES: Record<string, Record<string, unknown>> = {
  tr: {
    'Queen_(müzik_grubu)': summary(
      'tr',
      'Queen (müzik grubu)',
      'Queen, 1970 yılında Londra’da kurulan İngiliz rock grubudur. <b>Kalın</b> &amp; düz.'
    )
  },
  en: {
    'Queen_(band)': summary(
      'en',
      'Queen (band)',
      'Queen are a British rock band formed in London in 1970.'
    ),
    Johnny_Cash: summary('en', 'Johnny Cash', 'John R. Cash was an American singer-songwriter.'),
    NIN: summary('en', 'NIN', 'NIN may refer to:', 'disambiguation')
  }
}

/** Wikimedia sahte uç noktaları; istekler `log`'a yazılır. `gate` çözülene kadar yanıt bekletilir. */
export function wikimediaHandlers(log: URL[] = [], gate?: Promise<void>) {
  return [
    http.get('https://www.wikidata.org/w/api.php', async ({ request }) => {
      await gate
      const url = new URL(request.url)
      log.push(url)
      const p = url.searchParams
      if (p.get('action') === 'query' && p.get('list') === 'search') {
        const mbid = /^haswbstatement:P434=(.+)$/.exec(p.get('srsearch') ?? '')?.[1] ?? ''
        const qid = ITEM_BY_MBID[mbid]
        return HttpResponse.json({
          batchcomplete: true,
          query: {
            searchinfo: { totalhits: qid ? 1 : 0 },
            search: qid ? [{ ns: 0, title: qid, pageid: 1 }] : []
          }
        })
      }
      if (p.get('action') === 'wbgetentities') {
        const qid = p.get('ids') ?? ''
        const wanted = (p.get('sitefilter') ?? '').split('|')
        const links = Object.fromEntries(
          Object.entries(SITELINKS[qid] ?? {})
            .filter(([site]) => wanted.includes(site))
            .map(([site, title]) => [site, { site, title, badges: [] }])
        )
        return HttpResponse.json({
          entities: { [qid]: { type: 'item', id: qid, sitelinks: links } },
          success: 1
        })
      }
      return HttpResponse.json({ error: { code: 'badvalue', info: 'x' } })
    }),
    ...['tr', 'en'].map((lang) =>
      http.get(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/:title`,
        async ({ request, params }) => {
          await gate
          log.push(new URL(request.url))
          const page = SUMMARIES[lang]?.[decodeURIComponent(String(params.title))]
          return page
            ? HttpResponse.json(page)
            : HttpResponse.json(
                { type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' },
                { status: 404 }
              )
        }
      )
    )
  ]
}
