import type { ArtistSummary, SummaryLang } from '@shared/background'
import type { RequestOptions } from './sourceClient'
import type { WikimediaSource } from './sources/wikimedia'
import { toPlainText } from './text'

// Sanatçı özeti (PLAN 3.A4): MusicBrainz sanatçı MBID'si → Wikidata öğesi → Wikipedia sayfası →
// özet. Dil önceliği: kullanıcının dili (`tr`), yoksa `en`. Wikipedia metni CC BY-SA 4.0:
// kaynak URL'si ve lisans her zaman metinle birlikte döner. En fazla 2 + dil sayısı kadar istek.

const WIKIPEDIA_LICENSE = {
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
} as const

const SUMMARY_MAX = 5_000

/** Kullanıcı dili önce, ardından İngilizce (tekrarsız). */
export function languageOrder(lang: SummaryLang): SummaryLang[] {
  return lang === 'en' ? ['en'] : [lang, 'en']
}

export async function fetchArtistSummary(
  artist: { mbid: string; name: string },
  lang: SummaryLang,
  wm: Pick<WikimediaSource, 'itemForArtist' | 'sitelinks' | 'summary'>,
  opts: RequestOptions = {}
): Promise<ArtistSummary | null> {
  const qid = await wm.itemForArtist(artist.mbid, opts)
  if (!qid) return null
  const order = languageOrder(lang)
  const titles = await wm.sitelinks(qid, order, opts)

  for (const l of order) {
    const title = titles[l]
    if (!title) continue
    const res = await wm.summary(l, title, opts)
    const page = res.data
    // Anlam ayrımı sayfası sanatçı özeti değildir; boş özet atlanır.
    if (!page || page.type === 'disambiguation') continue
    const text = toPlainText(page.extract ?? '', SUMMARY_MAX)
    if (!text) continue
    const pageUrl = page.content_urls?.desktop?.page
    const url = pageUrl?.startsWith(`https://${l}.wikipedia.org/`)
      ? pageUrl
      : `https://${l}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    return {
      artistName: toPlainText(artist.name, 500),
      artistMbid: artist.mbid,
      wikidataId: qid,
      wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
      text,
      lang: l,
      title: toPlainText(page.title, 500),
      url,
      ...WIKIPEDIA_LICENSE,
      source: 'wikipedia',
      fetchedAt: res.fetchedAt
    }
  }
  return null
}
