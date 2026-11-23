import { z } from 'zod/mini'
import { CoreError } from '@shared/errors'
import type { SummaryLang } from '@shared/background'
import type { RequestOptions, SourceClient, SourceResult } from '../sourceClient'

// Wikidata + Wikipedia (PLAN 3.A4). İkisi aynı SourceClient'ı (aynı `wikimedia` hız sınırlayıcısı)
// kullanır: Wikimedia limiti tüm sitelerde ortaktır (policies.ts).
//  - MusicBrainz sanatçı MBID'si → Wikidata öğesi: "MusicBrainz artist ID" özelliği (P434) ile
//    `haswbstatement:P434=<mbid>` araması (https://www.wikidata.org/wiki/Property:P434).
//  - Öğe → Wikipedia sayfası: `wbgetentities` sitelinks (trwiki, enwiki).
//  - Sayfa → özet: REST `page/summary/<başlık>`; yalnızca düz metin `extract` kullanılır
//    (`extract_html` alınmaz).

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

const opt = <T extends z.ZodMiniType>(schema: T) => z.catch(z.optional(schema), undefined)
const QID = z.string().check(z.regex(/^Q\d{1,12}$/))

const SearchSchema = z.object({
  query: opt(z.object({ search: z.catch(z.array(z.object({ title: opt(z.string()) })), []) }))
})

const SitelinkSchema = z.object({ title: z.string().check(z.minLength(1), z.maxLength(500)) })
const EntitiesSchema = z.object({
  entities: opt(
    z.record(
      z.string(),
      z.object({
        sitelinks: opt(z.record(z.string(), z.catch(z.optional(SitelinkSchema), undefined)))
      })
    )
  )
})

const SummarySchema = z.object({
  type: opt(z.string()),
  title: z.string().check(z.maxLength(500)),
  extract: opt(z.string().check(z.maxLength(20_000))),
  lang: opt(z.string()),
  wikibase_item: opt(z.string()),
  content_urls: opt(z.object({ desktop: opt(z.object({ page: opt(z.string()) })) }))
})
export type WikipediaSummary = z.infer<typeof SummarySchema>

/** Action API gövdesindeki hata (HTTP 200 ile gelir): maxlag/ratelimited → hız sınırı. */
export function inspectWikimediaBody(body: unknown): CoreError | null {
  const error = (body as { error?: { code?: unknown } } | null)?.error
  if (!error || typeof error !== 'object') return null
  const code = typeof error.code === 'string' ? error.code : 'unknown'
  if (code === 'maxlag' || code === 'ratelimited') {
    return new CoreError('BG_RATE_LIMITED', `wikimedia: ${code}`)
  }
  return new CoreError('BG_REQUEST_FAILED', `wikimedia: API hatası (${code.slice(0, 40)})`)
}

export class WikimediaSource {
  constructor(private readonly client: SourceClient) {}

  private api(params: Record<string, string>): URL {
    const url = new URL(WIKIDATA_API)
    for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2' })) {
      url.searchParams.set(k, v)
    }
    return url
  }

  /** MusicBrainz sanatçı MBID'si → Wikidata öğe kimliği (P434). Yoksa `null`. */
  async itemForArtist(mbid: string, opts?: RequestOptions): Promise<string | null> {
    const res = await this.client.getJson(
      this.api({
        action: 'query',
        list: 'search',
        srsearch: `haswbstatement:P434=${mbid}`,
        srlimit: '1',
        srnamespace: '0'
      }),
      SearchSchema,
      opts
    )
    const title = res.data?.query?.search[0]?.title
    return title && QID.safeParse(title).success ? title : null
  }

  /** Öğenin verilen dillerdeki Wikipedia başlıkları. */
  async sitelinks(
    qid: string,
    langs: readonly SummaryLang[],
    opts?: RequestOptions
  ): Promise<Partial<Record<SummaryLang, string>>> {
    const res = await this.client.getJson(
      this.api({
        action: 'wbgetentities',
        ids: qid,
        props: 'sitelinks',
        sitefilter: langs.map((l) => `${l}wiki`).join('|')
      }),
      EntitiesSchema,
      opts
    )
    const links = res.data?.entities?.[qid]?.sitelinks ?? {}
    const out: Partial<Record<SummaryLang, string>> = {}
    for (const lang of langs) {
      const title = links[`${lang}wiki`]?.title
      if (title) out[lang] = title
    }
    return out
  }

  /** Wikipedia sayfa özeti (REST). Sayfa yoksa `data: null`. */
  summary(
    lang: SummaryLang,
    title: string,
    opts?: RequestOptions
  ): Promise<SourceResult<WikipediaSummary>> {
    const path = encodeURIComponent(title.replace(/ /g, '_'))
    return this.client.getJson(
      new URL(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${path}`),
      SummarySchema,
      opts
    )
  }
}
