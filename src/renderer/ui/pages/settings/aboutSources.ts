import type { MessageKey } from '@shared/i18n'

// Ayarlar → Hakkında (§3.5): veri kaynakları ve lisansları. Bağlantılar `SOURCE_LINK` kalıbına uymak
// zorunda (testli); main ayrıca doğrular.

export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

export const ABOUT_SOURCES: readonly {
  name: string
  what: MessageKey
  license: string | null
  url: string
}[] = [
  { name: 'Apple Music', what: 'about.src.apple', license: null, url: '' },
  {
    name: 'MusicBrainz',
    what: 'about.src.musicbrainz',
    license: 'CC0',
    url: 'https://musicbrainz.org/'
  },
  {
    name: 'Wikipedia',
    what: 'about.src.wikipedia',
    license: 'CC BY-SA 4.0',
    url: 'https://www.wikipedia.org/'
  },
  {
    name: 'Wikidata',
    what: 'about.src.wikidata',
    license: 'CC0',
    url: 'https://www.wikidata.org/'
  },
  { name: 'LRCLIB', what: 'about.src.lrclib', license: null, url: 'https://lrclib.net/' }
]
