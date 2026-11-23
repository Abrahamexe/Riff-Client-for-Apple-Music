import type { Locale } from '@shared/i18n'
import type {
  AlbumDetail,
  Artist,
  ArtistDetail,
  Card,
  CardGroup,
  Genre,
  Playlist,
  SongLinks,
  PlaylistDetail,
  RatingKind,
  SearchGroups,
  SearchResults,
  SearchSuggestions,
  Track
} from '@shared/ipc-contract'
import type { z } from 'zod/mini'
import { codeFromStatus, CoreError, logError } from '@shared/errors'
import { withRetry, type RetryOptions } from '@shared/retry'
import {
  ChartsBodySchema,
  PageSchema,
  parseResources,
  RatingsBodySchema,
  toCard,
  editorialNoteOf,
  pathLabel,
  reportSchemaDrift,
  SearchBodySchema,
  StorefrontBodySchema,
  SuggestionsBodySchema,
  TermSuggestionSchema,
  TopSuggestionSchema,
  toAlbum,
  toArtist,
  artworkUrl,
  toPlaylist,
  toLibraryAlbum,
  toLibraryArtist,
  toLibrarySong,
  toTrack,
  type LibraryAlbum,
  type LibrarySong,
  type Resource
} from './schemas'

// Apple Music API istemcisi (PLAN 1.7 → 1.7a: renderer'dan worker'a taşındı). MusicKit'in
// `music.api.music()` yerine doğrudan HTTPS; token'lar worker belleğinde durur, renderer'a gitmez.
//  - aynı anda yapılan aynı GET tek isteğe indirilir (dedupe)
//  - 429 / 5xx / ağ hatası → üstel geri çekilme (Retry-After'a uyar)
//  - 401/403 → UNAUTHORIZED (renderer yeniden giriş ister)
//  - tüm yanıtlar zod şemasından geçer (schemas.ts)

const API_BASE_URL = 'https://api.music.apple.com'
export const PAGE_SIZE = 100
const RECENT_PAGE_SIZE = 30
/** `/v1/catalog/{sf}/songs?ids=` tek istekte (Apple sınırı 300; URL uzunluğu için daha az). */
const ISRC_BATCH = 100
/** Toplamı bilinen sayfalı isteklerde aynı anda en fazla bu kadar sayfa (Apple'a nazik yük). */
const PAGE_CONCURRENCY = 4
/**
 * Sonsuz döngü koruması (A4): 2.000 sayfa × 100 = 200.000 öğe (Apple Music kütüphanesi 100.000
 * şarkıyı aşabilir). Aşılırsa `LIBRARY_TRUNCATED` uyarısı loglanır (sessizce eksik kalmaz).
 */
export const MAX_PAGES = 2_000
const DEFAULT_TIMEOUT_MS = 15_000
/**
 * P8 (F1): yönlendirmeler elle izlenir. Fetch, başka origin'e yönlendirmede yalnızca `Authorization`'ı
 * düşürür; `Music-User-Token` gibi özel başlıklar yeni hedefe giderdi. Yalnızca aynı origin'e (Apple
 * API) ve yalnızca okuma isteğinde en fazla bu kadar adım izlenir; aksi `API_REQUEST_FAILED`.
 */
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface AppleApiOptions {
  /** `refresh`: önbellekteki token'ı atıp yenisini iste (Apple 401; PLAN_v5 A3.1). */
  getDeveloperToken: (refresh?: boolean) => Promise<string>
  /** Giriş yapılmamışsa `null`. */
  getUserToken: () => string | null
  fetch?: typeof fetch
  retry?: RetryOptions
  timeoutMs?: number
  /** Yalnızca test: sayfa sınırı (varsayılan `MAX_PAGES`). */
  maxPages?: number
}

type Params = Record<string, string | number>

/** Kütüphaneye / favorilere eklenecek katalog öğeleri (`ids[songs]=…`). */
export interface LibraryIds {
  songs?: readonly string[]
  albums?: readonly string[]
  playlists?: readonly string[]
}

/** Playlist isteklerindeki şarkı başvurusu. */
export interface TrackRefBody {
  id: string
  type: 'songs' | 'library-songs'
}

const idsParams = (ids: LibraryIds): Params => {
  const params: Params = {}
  for (const [type, list] of Object.entries(ids) as [string, readonly string[] | undefined][]) {
    if (list && list.length > 0) params[`ids[${type}]`] = list.join(',')
  }
  if (Object.keys(params).length === 0) {
    throw new CoreError('INVALID_ARGUMENT', 'Eklenecek öğe yok.')
  }
  return params
}

/** Retry-After: saniye veya HTTP tarihi → ms. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

const encodeId = (id: string): string => encodeURIComponent(id)

/**
 * B5 gözlemi (2026-10-13, resmi API, `l=tr-TR`): albüm görünümleri "Diğer Versiyonlar", "İlgili
 * Albümler", "Şurada Yer Alıyor:"; sanatçı görünümleri "Albümler", "Single’lar ve EP’ler", "Canlı
 * Albümler", "Derlemeler", "Yer Aldıkları", "Sanatçı Listeleri", "Benzer Sanatçılar". Sıra Apple
 * Music sayfalarındaki gibi. Müzik videoları (`related-videos`, `top-music-videos`) v1'de yok.
 */
const ALBUM_VIEWS = ['other-versions', 'related-albums', 'appears-on'] as const
const ARTIST_VIEWS = [
  'full-albums',
  'singles',
  'live-albums',
  'compilation-albums',
  'appears-on-albums',
  'featured-playlists',
  'similar-artists'
] as const
const PLAYLIST_VIEWS = ['featured-artists'] as const
/** "Yeni" listelerinin sırası (Apple Music: parçalar, albümler, listeler, günlük, şehir). */
const CHART_KINDS = ['songs', 'albums', 'playlists', 'dailyGlobalTopCharts', 'cityCharts'] as const
/** Apple'ın kök "Müzik" türü (tümü); seçicide "Tüm Türler" olarak arayüzden gösterilir. */
const ROOT_GENRE_ID = '34'
const GENRES_LIMIT = 50
const GENRE_STATIONS_LIMIT = 25

/** Görünümler → başlıklı kart rafları (boşlar atlanır; başlık Apple'dan, yoksa boş). */
const viewGroups = (r: Resource, names: readonly string[]): CardGroup[] =>
  names
    .map((name) => ({
      id: name,
      title: r.views?.[name]?.attributes?.title ?? '',
      cards: cards(resourcesOf(r.views?.[name]?.data))
    }))
    .filter((g) => g.cards.length > 0)

/** Türler; Apple'ın genel "Müzik" türü atlanır. */
const genresOf = (r: Resource): string[] =>
  (r.attributes?.genreNames ?? []).filter((g) => g !== 'Music' && g !== 'Müzik')

/** Apple dil etiketi (ör. `tr-TR`, `en-GB`, `zh-Hant-TW`); başka biçim kullanılmaz. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/

/** İlişki/görünüm verisinden geçerli kaynaklar (geçersizler atlanır). */
const resourcesOf = (data: unknown[] | undefined): Resource[] =>
  parseResources(data ?? []).resources

/** Kaynaklar → kartlar; desteklenmeyen tür (ör. müzik videosu) atlanır. */
const cards = (resources: readonly Resource[]): Card[] =>
  resources.map(toCard).filter((c): c is Card => c !== null)

/** Şema sapması: katalog kodlu uyarı (yalnızca yol ve sorun kodu). */
/** Desteklenmeyen kart türleri (ör. müzik videosu) atlanır. */
const cardsOf = (resources: readonly Resource[]): Card[] =>
  resources.map(toCard).filter((c): c is Card => c !== null)

const logDrift = (message: string): void =>
  void logError('apple-api', new CoreError('API_RESPONSE_INVALID', message))

/** Yanıtı şemayla doğrular; uymazsa katalog kodlu hata (ZodError süreç sınırına sızmaz). */
function parseBody<T>(schema: z.ZodMiniType<T>, what: string, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new CoreError('API_RESPONSE_INVALID', `${what}: yanıt beklenen biçimde değil.`)
  }
  return parsed.data
}

export class AppleMusicApi {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private storefront: { userToken: string; id: string; languages: readonly string[] } | null = null

  constructor(private readonly options: AppleApiOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  isSignedIn(): boolean {
    return this.options.getUserToken() !== null
  }

  /**
   * Tek GET isteği (dedupe + retry). Dönen gövde henüz doğrulanmamıştır. `signal` verilirse
   * (iptal edilebilir istek, 3.B1) paylaşılmaz: birinin iptali başkasının isteğini kesmesin.
   */
  get(path: string, params: Params = {}, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(path, API_BASE_URL)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    if (signal) return withRetry(() => this.once(url, path, signal), this.options.retry)
    const key = url.toString()
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const request = withRetry(() => this.once(url, path), this.options.retry).finally(() =>
      this.inFlight.delete(key)
    )
    this.inFlight.set(key, request)
    return request
  }

  /** Sayfalama: `next` bitene kadar `offset` ilerletir; `maxItems` verilirse erken durur. */
  async fetchAll(
    path: string,
    params: Params = {},
    { pageSize = PAGE_SIZE, maxItems = Infinity }: { pageSize?: number; maxItems?: number } = {}
  ): Promise<Resource[]> {
    let dropped = 0
    let truncated = false
    const maxPages = this.options.maxPages ?? MAX_PAGES
    const fetchPage = async (
      page: number
    ): Promise<{ resources: Resource[]; next: boolean; total?: number }> => {
      const body = parseBody(
        PageSchema,
        path,
        await this.get(path, { ...params, limit: pageSize, offset: page * pageSize })
      )
      reportSchemaDrift(pathLabel(path), body.data, logDrift)
      const parsed = parseResources(body.data)
      dropped += parsed.dropped
      return { resources: parsed.resources, next: body.next !== undefined, total: body.meta?.total }
    }

    const first = await fetchPage(0)
    const pages: Resource[][] = [first.resources]
    const total = first.total
    if (first.next && total !== undefined && maxItems === Infinity) {
      // 2.2: toplam biliniyorsa kalan sayfalar sınırlı eşzamanlılıkla, sırası korunarak çekilir
      // (V5 ölçümü: 1.204 şarkılık playlist sıralı ~11 sn).
      const needed = Math.ceil(total / pageSize)
      truncated = needed > maxPages
      const count = Math.min(needed, maxPages)
      const rest = Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 1)
      let cursor = 0
      const worker = async (): Promise<void> => {
        while (cursor < rest.length) {
          const page = rest[cursor++]!
          pages[page] = (await fetchPage(page)).resources
        }
      }
      await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, rest.length) }, worker))
    } else if (first.next) {
      // Toplam yok (ör. son çalınanlar): `next` bitene kadar sıralı.
      let collected = first.resources.length
      let more = true
      for (let page = 1; page < maxPages && collected < maxItems; page++) {
        const next = await fetchPage(page)
        pages.push(next.resources)
        collected += next.resources.length
        more = next.next
        if (!more) break
      }
      truncated = more && collected < maxItems && pages.length >= maxPages
    }
    const items = pages.flat()
    if (truncated) {
      logError(
        'apple-api',
        new CoreError(
          'LIBRARY_TRUNCATED',
          `${pathLabel(path)}: ${maxPages} sayfa sınırı; ${total ?? 'bilinmeyen sayıda'} öğeden ${items.length} alındı`
        )
      )
    }
    if (dropped > 0) {
      logError(
        'apple-api',
        new CoreError('API_RESPONSE_INVALID', `${pathLabel(path)}: ${dropped} geçersiz öğe atlandı`)
      )
    }
    return items.slice(0, maxItems === Infinity ? undefined : maxItems)
  }

  async getPlaylists(): Promise<Playlist[]> {
    return (await this.fetchAll('/v1/me/library/playlists')).map(toPlaylist)
  }

  async getPlaylistTracks(playlistId: string): Promise<Track[]> {
    const path = `/v1/me/library/playlists/${encodeId(playlistId)}/tracks`
    try {
      return (await this.fetchAll(path)).map(toTrack)
    } catch (err) {
      // Apple boş playlist için 404 döner.
      if (err instanceof CoreError && err.status === 404) return []
      throw err
    }
  }

  async getRecentlyPlayed(limit = 30): Promise<Track[]> {
    const items = await this.fetchAll(
      '/v1/me/recent/played/tracks',
      {},
      { pageSize: RECENT_PAGE_SIZE, maxItems: limit }
    )
    return items.map(toTrack)
  }

  /** Kullanıcının hesabındaki storefront (sabit yazılmaz); user token başına cache'lenir. */
  async getStorefront(): Promise<string> {
    const userToken = this.options.getUserToken()
    if (userToken === null) throw new CoreError('NOT_SIGNED_IN', 'Giriş yapılmamış.')
    if (this.storefront?.userToken === userToken) return this.storefront.id
    const parsed = StorefrontBodySchema.safeParse(await this.get('/v1/me/storefront'))
    if (!parsed.success) {
      throw new CoreError('API_RESPONSE_INVALID', 'Storefront yanıtı beklenen biçimde değil.')
    }
    const first = parsed.data.data[0]!
    const languages = (first.attributes?.supportedLanguageTags ?? []).filter((t) =>
      LANGUAGE_TAG.test(t)
    )
    this.storefront = { userToken, id: first.id, languages }
    return first.id
  }

  /**
   * Arayüz diline uyan, storefront'un desteklediği dil etiketi (Apple `l` parametresi); yoksa
   * `undefined` (Apple storefront'un varsayılan dilini kullanır).
   */
  private async languageTag(locale: Locale | undefined): Promise<string | undefined> {
    if (!locale) return undefined
    await this.getStorefront()
    const tags = this.storefront?.languages ?? []
    return tags.find((t) => t.toLowerCase().split('-')[0] === locale)
  }

  async searchCatalog(term: string, limit = 10, storefront?: string): Promise<SearchResults> {
    if (!storefront && !this.isSignedIn()) {
      throw new CoreError(
        'INVALID_ARGUMENT',
        'Katalog araması için giriş yapın ya da storefront verin.'
      )
    }
    const sf = storefront ?? (await this.getStorefront())
    const body = await this.get(`/v1/catalog/${encodeId(sf)}/search`, {
      term,
      types: 'songs,playlists',
      limit
    })
    return this.searchResults(body, 'songs', 'playlists')
  }

  /**
   * Katalog şarkılarının ISRC'leri (V8). Tek istekte en fazla `ISRC_BATCH` id; storefront hesaptan.
   * Dönen haritada olmayan id: Apple'da bulunamadı; değeri `null`: şarkı var ama ISRC yok.
   */
  async getSongIsrcs(ids: readonly string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    const unique = [...new Set(ids)].filter((id) => /^[0-9]{1,20}$/.test(id))
    if (unique.length === 0) return out
    const sf = await this.getStorefront()
    for (let i = 0; i < unique.length; i += ISRC_BATCH) {
      const chunk = unique.slice(i, i + ISRC_BATCH)
      const path = `/v1/catalog/${encodeId(sf)}/songs`
      const body = parseBody(PageSchema, path, await this.get(path, { ids: chunk.join(',') }))
      for (const r of parseResources(body.data).resources) {
        out.set(r.id, r.attributes?.isrc?.toUpperCase() ?? null)
      }
    }
    return out
  }

  async searchLibrary(term: string, limit = 10): Promise<SearchResults> {
    const body = await this.get('/v1/me/library/search', {
      term,
      types: 'library-songs,library-playlists',
      limit
    })
    return this.searchResults(body, 'library-songs', 'library-playlists')
  }

  /**
   * Birleşik aramanın bir kaynağı (3.B1): şarkı, albüm, sanatçı, playlist tek istekte. Katalogda
   * storefront kullanıcının hesabından alınır. İptal edilirse `REQUEST_CANCELLED`.
   */
  async searchGroups(
    source: 'catalog' | 'library',
    term: string,
    limit: number,
    signal?: AbortSignal,
    locale?: Locale
  ): Promise<SearchGroups> {
    const prefix = source === 'library' ? 'library-' : ''
    const path =
      source === 'library'
        ? '/v1/me/library/search'
        : `/v1/catalog/${encodeId(await this.getStorefront())}/search`
    // B7: katalogda istasyonlar da (Apple Music arama sonuçlarındaki "İstasyonlar").
    const types = [
      ...['songs', 'albums', 'artists', 'playlists'].map((t) => prefix + t),
      ...(source === 'catalog' ? ['stations'] : [])
    ]
    // P2: katalogda Apple'ın "En iyi sonuçlar"ı aynı istekte (`results.topResults`, gözlem).
    // B7: katalog adları arayüz dilinde (gözlem: `l` yokken istasyonlar İngilizce, ör. "Pop Station").
    const l = source === 'catalog' ? await this.languageTag(locale) : undefined
    const body = await this.get(
      path,
      {
        term,
        types: types.join(','),
        limit,
        ...(source === 'catalog' ? { with: 'topResults' } : {}),
        ...(l ? { l } : {})
      },
      signal
    )
    const results = parseBody(SearchBodySchema, 'search', body).results
    const resources = (key: string): Resource[] => {
      const data = parseBody(PageSchema, `search:${key}`, results[key] ?? {}).data
      reportSchemaDrift(`search:${key}`, data, logDrift)
      const parsed = parseResources(data)
      if (parsed.dropped > 0) logDrift(`search:${key}: ${parsed.dropped} geçersiz öğe atlandı`)
      return parsed.resources
    }
    return {
      top: source === 'catalog' ? cardsOf(resources('topResults')) : [],
      songs: resources(`${prefix}songs`).map(toTrack),
      albums: resources(`${prefix}albums`).map(toAlbum),
      artists: resources(`${prefix}artists`).map(toArtist),
      playlists: resources(`${prefix}playlists`).map(toPlaylist),
      stations: source === 'catalog' ? cardsOf(resources('stations')) : []
    }
  }

  /**
   * Yazarken öneriler (P2): tamamlanmış terimler + en iyi eşleşmeler (yalnızca katalog; storefront
   * hesaptan). Desteklenmeyen tür (ör. müzik videosu) atlanır.
   */
  async searchSuggestions(
    term: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<Omit<SearchSuggestions, 'term'>> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/search/suggestions`
    const body = parseBody(
      SuggestionsBodySchema,
      'search:suggestions',
      await this.get(
        path,
        { term, kinds: 'terms,topResults', types: 'songs,albums,artists,playlists', limit },
        signal
      )
    )
    const terms: SearchSuggestions['terms'] = []
    const contents: unknown[] = []
    let dropped = 0
    for (const item of body.results.suggestions) {
      const asTerm = TermSuggestionSchema.safeParse(item)
      if (asTerm.success) {
        terms.push({ searchTerm: asTerm.data.searchTerm, displayTerm: asTerm.data.displayTerm })
        continue
      }
      const asTop = TopSuggestionSchema.safeParse(item)
      if (asTop.success) contents.push(asTop.data.content)
      else dropped++
    }
    const parsed = parseResources(contents)
    dropped += parsed.dropped
    if (dropped > 0) logDrift(`search:suggestions: ${dropped} geçersiz öğe atlandı`)
    return { terms, top: cardsOf(parsed.resources) }
  }

  // --- Arayüz veri kapsamı -------------------------------------------------------------------

  /**
   * §3.6: besteci katalog ilişkisinden, yalnızca o alan (`fields[songs]`; gözlem: yanıt %35 büyük,
   * sayfa başına ~+150 ms; kataloğu olmayan yüklenmiş şarkıda besteci yok).
   */
  async getLibrarySongs(): Promise<LibrarySong[]> {
    return (
      await this.fetchAll('/v1/me/library/songs', {
        include: 'catalog',
        'fields[songs]': 'composerName'
      })
    ).map(toLibrarySong)
  }

  /** §3.6: derleme bilgisi katalog albümünden (`fields[albums]=isCompilation`). */
  async getLibraryAlbums(): Promise<LibraryAlbum[]> {
    return (
      await this.fetchAll('/v1/me/library/albums', {
        include: 'catalog',
        'fields[albums]': 'isCompilation'
      })
    ).map(toLibraryAlbum)
  }

  /** Görsel katalog sanatçısından (`toLibraryArtist`). */
  async getLibraryArtists(): Promise<Artist[]> {
    return (
      await this.fetchAll('/v1/me/library/artists', {
        include: 'catalog',
        'fields[artists]': 'name,artwork'
      })
    ).map(toLibraryArtist)
  }

  /** Son eklenenler: Apple sayfa boyutu en fazla 25 (gözlem: 50 → 400). */
  async getRecentlyAdded(limit: number): Promise<Card[]> {
    const resources = await this.fetchAll(
      '/v1/me/library/recently-added',
      {},
      {
        pageSize: 25,
        maxItems: limit
      }
    )
    return cards(resources)
  }

  /** Albüm + şarkıları. `l.…` kütüphane albümü; diğerleri katalog (hesabın mağazası). */
  async getAlbum(id: string, locale?: Locale): Promise<AlbumDetail> {
    const library = id.startsWith('l.')
    const path = library
      ? `/v1/me/library/albums/${encodeId(id)}`
      : `/v1/catalog/${encodeId(await this.getStorefront())}/albums/${encodeId(id)}`
    const l = library ? undefined : await this.languageTag(locale)
    const album = await this.getOne(
      path,
      library
        ? { include: 'tracks' }
        : { extend: 'audioVariants', views: ALBUM_VIEWS.join(','), ...(l ? { l } : {}) }
    )
    const tracks = await this.relationshipAll(album, 'tracks', `${path}/tracks`)
    const a = album.attributes
    return {
      album: toAlbum(album),
      tracks: tracks.map(toTrack),
      genres: genresOf(album),
      copyright: a?.copyright ?? null,
      recordLabel: a?.recordLabel ?? null,
      editorialNote: editorialNoteOf(album),
      artistId: library ? null : (resourcesOf(album.relationships?.artists?.data)[0]?.id ?? null),
      audioVariants: a?.audioVariants ?? [],
      sections: viewGroups(album, ALBUM_VIEWS)
    }
  }

  /** Sanatçı sayfası. Katalog: tek istekte görünümler; kütüphane (`r.…`): yalnızca albümleri. */
  async getArtist(id: string, locale?: Locale): Promise<ArtistDetail> {
    if (id.startsWith('r.')) {
      const path = `/v1/me/library/artists/${encodeId(id)}`
      const [artist, albums] = await Promise.all([
        this.getOne(path),
        this.fetchAll(`${path}/albums`)
      ])
      return {
        artist: toArtist(artist),
        topSongs: [],
        latestRelease: null,
        albums: albums.map(toAlbum),
        singles: [],
        similarArtists: [],
        topSongsTitle: null,
        latestReleaseTitle: null,
        genres: [],
        editorialNote: null,
        // Kütüphane sanatçısı: yalnızca arşivdeki albümleri (başlık arayüzden).
        sections: [{ id: 'library-albums', title: '', cards: cards(albums) }].filter(
          (g) => g.cards.length > 0
        )
      }
    }
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/artists/${encodeId(id)}`
    const l = await this.languageTag(locale)
    const artist = await this.getOne(path, {
      views: ['top-songs', 'latest-release', ...ARTIST_VIEWS].join(','),
      ...(l ? { l } : {})
    })
    const view = (name: string): Resource[] => resourcesOf(artist.views?.[name]?.data)
    const title = (name: string): string | null => artist.views?.[name]?.attributes?.title ?? null
    return {
      artist: toArtist(artist),
      topSongs: view('top-songs').map(toTrack),
      latestRelease: view('latest-release').map(toAlbum)[0] ?? null,
      albums: view('full-albums').map(toAlbum),
      singles: view('singles').map(toAlbum),
      similarArtists: view('similar-artists').map(toArtist),
      topSongsTitle: title('top-songs'),
      latestReleaseTitle: title('latest-release'),
      genres: genresOf(artist),
      editorialNote: editorialNoteOf(artist),
      sections: viewGroups(artist, ARTIST_VIEWS)
    }
  }

  /** Katalog playlist'i + şarkıları (100'den fazlası ayrı sayfalarla). */
  async getCatalogPlaylist(id: string, locale?: Locale): Promise<PlaylistDetail> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/playlists/${encodeId(id)}`
    const l = await this.languageTag(locale)
    const playlist = await this.getOne(path, {
      views: PLAYLIST_VIEWS.join(','),
      ...(l ? { l } : {})
    })
    const tracks = await this.relationshipAll(playlist, 'tracks', `${path}/tracks`)
    return {
      playlist: toPlaylist(playlist),
      curatorName: playlist.attributes?.curatorName ?? '',
      tracks: tracks.map(toTrack),
      sections: viewGroups(playlist, PLAYLIST_VIEWS)
    }
  }

  /**
   * Ana Sayfa: kişisel öneri grupları (başlık + içerik kartları). Boş gruplar atlanır. Başlıklar
   * Apple'dan arayüz dilinde gelir (`l`; B4 ek gözlemi: `tr-TR` → "Sana Özel Listeler").
   */
  async getRecommendations(locale?: Locale): Promise<CardGroup[]> {
    const path = '/v1/me/recommendations'
    const l = await this.languageTag(locale)
    const groups = await this.fetchAll(path, l ? { l } : {}, { pageSize: 30, maxItems: 30 })
    return groups
      .map((g) => ({
        id: g.id,
        title: g.attributes?.title?.stringForDisplay ?? '',
        cards: cards(resourcesOf(g.relationships?.contents?.data))
      }))
      .filter((g) => g.cards.length > 0)
  }

  /** Ana Sayfa: kullanıcının son dönemde sık çaldıkları (albüm, playlist, istasyon). */
  async getHeavyRotation(limit: number): Promise<Card[]> {
    const items = await this.fetchAll(
      '/v1/me/history/heavy-rotation',
      {},
      { pageSize: Math.min(limit, 10), maxItems: limit }
    )
    return cards(items)
  }

  /**
   * "Yeni" (B6): mağazanın listeleri. B6 gözlemi (2026-10-13, `tr`, `l=tr-TR`): `songs`, `albums`,
   * `playlists` → "Popüler Parçalar / Albümler / Listeler" (`most-played`); `with=cityCharts,
   * dailyGlobalTopCharts` → "Şehir Listeleri", "Günlük Top 100" (playlist). Türe göre (`genre`)
   * yalnızca şarkı ve albüm listeleri gelir; şehir / günlük listeler türsüzdür.
   */
  async getCharts(limit: number, locale?: Locale, genre?: string): Promise<CardGroup[]> {
    const sf = encodeId(await this.getStorefront())
    const path = `/v1/catalog/${sf}/charts`
    const l = await this.languageTag(locale)
    const body = parseBody(
      ChartsBodySchema,
      path,
      await this.get(path, {
        types: 'songs,albums,playlists',
        limit,
        ...(genre ? { genre } : { with: 'dailyGlobalTopCharts,cityCharts' }),
        ...(l ? { l } : {})
      })
    )
    const groups: CardGroup[] = []
    for (const type of CHART_KINDS) {
      for (const chart of body.results[type] ?? []) {
        groups.push({
          id: `${type}:${chart.chart ?? ''}`,
          title: chart.name ?? '',
          cards: cards(resourcesOf(chart.data))
        })
      }
    }
    return groups.filter((g) => g.cards.length > 0)
  }

  /** Şarkı menüsü: katalog şarkısının albümü ve sanatçısı (ilişkiler aynı istekte). */
  async getSongLinks(id: string): Promise<SongLinks> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/songs/${encodeId(id)}`
    const song = await this.getOne(path, { include: 'albums,artists' })
    const album = resourcesOf(song.relationships?.albums?.data)[0]
    const artist = resourcesOf(song.relationships?.artists?.data)[0]
    return {
      albumId: album?.id ?? null,
      albumName: album?.attributes?.name ?? song.attributes?.albumName ?? '',
      albumArtworkUrl: artworkUrl(album?.attributes?.artwork?.url ?? song.attributes?.artwork?.url),
      artistId: artist?.id ?? null,
      artistName: artist?.attributes?.name ?? song.attributes?.artistName ?? ''
    }
  }

  /** "Yeni" (B6): listelerin tür seçicisi; Apple'ın genel "Müzik" türü (34, kök) atlanır. */
  async getGenres(locale?: Locale): Promise<Genre[]> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/genres`
    return this.genreList(path, locale, (g) => g.id !== ROOT_GENRE_ID)
  }

  /** Radyo: Apple Music canlı istasyonları (B6 gözlemi: 6 istasyon, 4320×1080 görsel, tanıtım). */
  async getLiveStations(locale?: Locale): Promise<Card[]> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/stations`
    const l = await this.languageTag(locale)
    const body = parseBody(
      PageSchema,
      path,
      await this.get(path, { 'filter[featured]': 'apple-music-live-radio', ...(l ? { l } : {}) })
    )
    return cards(resourcesOf(body.data))
  }

  /** Radyo (B6): son dinlenen istasyonlar (gözlem: kişisel, sanatçı ve canlı istasyonlar karışık). */
  async getRecentStations(limit: number, locale?: Locale): Promise<Card[]> {
    const l = await this.languageTag(locale)
    const items = await this.fetchAll('/v1/me/recent/radio-stations', l ? { l } : {}, {
      pageSize: Math.min(limit, 10),
      maxItems: limit
    })
    return cards(items)
  }

  /** Radyo (B6): istasyon türleri (gözlem: 13 tür, `tr-TR` adlarıyla). */
  async getStationGenres(locale?: Locale): Promise<Genre[]> {
    const path = `/v1/catalog/${encodeId(await this.getStorefront())}/station-genres`
    return this.genreList(path, locale)
  }

  /** Radyo (B6): bir türün istasyonları (gözlem: Pop 18 istasyon, tek sayfa). */
  async getGenreStations(id: string, locale?: Locale): Promise<Card[]> {
    const sf = encodeId(await this.getStorefront())
    const path = `/v1/catalog/${sf}/station-genres/${encodeId(id)}/stations`
    const l = await this.languageTag(locale)
    const body = parseBody(
      PageSchema,
      path,
      await this.get(path, { limit: GENRE_STATIONS_LIMIT, ...(l ? { l } : {}) })
    )
    return cards(resourcesOf(body.data))
  }

  /** Tür listesi (tek sayfa; Apple sırasıyla). Adı olmayan tür atlanır. */
  private async genreList(
    path: string,
    locale: Locale | undefined,
    keep: (g: Genre) => boolean = () => true
  ): Promise<Genre[]> {
    const l = await this.languageTag(locale)
    const body = parseBody(
      PageSchema,
      path,
      await this.get(path, { limit: GENRES_LIMIT, ...(l ? { l } : {}) })
    )
    return resourcesOf(body.data)
      .map((r) => ({ id: r.id, name: r.attributes?.name ?? '' }))
      .filter((g) => g.name !== '' && keep(g))
  }

  /** Tek kaynak; 404 → CONTENT_NOT_FOUND. */
  private async getOne(path: string, params: Params = {}): Promise<Resource> {
    let body: unknown
    try {
      body = await this.get(path, params)
    } catch (err) {
      if (err instanceof CoreError && err.status === 404) {
        throw new CoreError('CONTENT_NOT_FOUND', `${pathLabel(path)}: bulunamadı.`, { status: 404 })
      }
      throw err
    }
    const resource = resourcesOf(parseBody(PageSchema, path, body).data)[0]
    if (!resource) throw new CoreError('CONTENT_NOT_FOUND', `${pathLabel(path)}: boş yanıt.`)
    return resource
  }

  /** İlişkinin ilk sayfası yanıtta gelir; devamı (`next`) varsa tamamı ayrıca çekilir. */
  private async relationshipAll(
    resource: Resource,
    name: string,
    path: string
  ): Promise<Resource[]> {
    const rel = resource.relationships?.[name]
    if (!rel) return []
    if (rel.next) return this.fetchAll(path)
    return resourcesOf(rel.data)
  }

  async probeLibraryAccess(): Promise<number> {
    const path = '/v1/me/library/playlists'
    const body = parseBody(PageSchema, path, await this.get(path, { limit: 1 }))
    return parseResources(body.data).resources.length
  }

  private searchResults(body: unknown, songsKey: string, playlistsKey: string): SearchResults {
    const results = parseBody(SearchBodySchema, 'search', body).results
    const resources = (key: string): Resource[] => {
      const data = parseBody(PageSchema, `search:${key}`, results[key] ?? {}).data
      reportSchemaDrift(`search:${key}`, data, logDrift)
      const parsed = parseResources(data)
      if (parsed.dropped > 0) logDrift(`search:${key}: ${parsed.dropped} geçersiz öğe atlandı`)
      return parsed.resources
    }
    return {
      songs: resources(songsKey).map(toTrack),
      playlists: resources(playlistsKey).map(toPlaylist)
    }
  }

  /**
   * Yazma isteği (3.B2). Yeniden DENENMEZ: playlist oluşturma gibi istekler tekrarlanırsa çoğalabilir;
   * geçici hatada (ağ yok, 429, 5xx) çağıran (LibraryWriter) işlemi kuyruğa alır. 202/204 → `null`.
   */
  async send(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    params: Params = {},
    body?: unknown
  ): Promise<unknown> {
    const url = new URL(path, API_BASE_URL)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    return this.once(url, path, undefined, { method, body })
  }

  /** Katalog öğelerini kullanıcının kütüphanesine ekler (POST /v1/me/library, 202). */
  async addToLibrary(ids: LibraryIds): Promise<void> {
    await this.send('POST', '/v1/me/library', idsParams(ids))
  }

  /** Favorilere ekler (POST /v1/me/favorites, 202): şarkı "Favori Şarkılar" listesine girer. */
  async addToFavorites(ids: LibraryIds): Promise<void> {
    await this.send('POST', '/v1/me/favorites', idsParams(ids))
  }

  /** Yeni kütüphane playlist'i (POST /v1/me/library/playlists, 201); oluşan playlist döner. */
  async createPlaylist(
    name: string,
    description: string,
    tracks: readonly TrackRefBody[]
  ): Promise<Playlist> {
    const body = {
      attributes: { name, description },
      ...(tracks.length > 0 ? { relationships: { tracks: { data: tracks } } } : {})
    }
    const path = '/v1/me/library/playlists'
    const res = parseBody(PageSchema, path, await this.send('POST', path, {}, body))
    const created = parseResources(res.data).resources[0]
    if (!created) throw new CoreError('API_RESPONSE_INVALID', `${path}: oluşan playlist yok.`)
    return toPlaylist(created)
  }

  /** Playlist'in sonuna şarkı ekler (POST …/playlists/{id}/tracks, 204). */
  async addTracksToPlaylist(playlistId: string, tracks: readonly TrackRefBody[]): Promise<void> {
    await this.send(
      'POST',
      `/v1/me/library/playlists/${encodeId(playlistId)}/tracks`,
      {},
      {
        data: tracks
      }
    )
  }

  /** Sev (1) / sevme (-1) / kaldır (`null` → DELETE). PUT/DELETE /v1/me/ratings/{tür}/{id}. */
  async setRating(kind: RatingKind, id: string, value: 1 | -1 | null): Promise<void> {
    const path = `/v1/me/ratings/${kind}/${encodeId(id)}`
    if (value === null) await this.send('DELETE', path)
    else await this.send('PUT', path, {}, { type: 'ratings', attributes: { value } })
  }

  /** Kişisel puanlar (GET /v1/me/ratings/{tür}?ids=); puanı olmayan öğe dönmez. */
  async getRatings(kind: RatingKind, ids: readonly string[]): Promise<Map<string, 1 | -1>> {
    const path = `/v1/me/ratings/${kind}`
    const body = parseBody(RatingsBodySchema, path, await this.get(path, { ids: ids.join(',') }))
    const out = new Map<string, 1 | -1>()
    for (const r of body.data)
      if (r.attributes?.value !== undefined) out.set(r.id, r.attributes.value)
    return out
  }

  private async once(
    url: URL,
    path: string,
    signal?: AbortSignal,
    write?: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }
  ): Promise<unknown> {
    let res = await this.attempt(url, path, false, signal, write)
    // A3.1 (D1): 401 = Apple developer token'ı reddetti (süresi dolmuş / iptal). Oturum silinmeden
    // önce main'den zorla yenilenmiş token'la bir kez tekrarlanır; yine 401 → UNAUTHORIZED. 403
    // (kullanıcı token'ı) yenilemeyle düzelmez, tekrarlanmaz. Yazma da güvenle tekrarlanır: 401'de
    // Apple isteği işlemedi.
    if (res.status === 401) res = await this.attempt(url, path, true, signal, write)

    if (!res.ok) {
      // Yanıt gövdesi loglanmaz/iletilmez: yalnızca durum kodu.
      throw new CoreError(
        codeFromStatus(res.status) ?? 'API_REQUEST_FAILED',
        `Apple Music API hatası (HTTP ${res.status}).`,
        { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) }
      )
    }
    // 202 Accepted / 204 No Content: gövde yok.
    if (res.status === 202 || res.status === 204) return null
    try {
      return await res.json()
    } catch (cause) {
      throw new CoreError('API_REQUEST_FAILED', 'Apple Music yanıtı çözümlenemedi.', { cause })
    }
  }

  private async attempt(
    url: URL,
    path: string,
    refreshToken: boolean,
    signal?: AbortSignal,
    write?: { method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }
  ): Promise<Response> {
    const cancelled = (): CoreError =>
      new CoreError('REQUEST_CANCELLED', 'Apple Music isteği iptal edildi.')
    if (signal?.aborted) throw cancelled()
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.options.getDeveloperToken(refreshToken)}`
    }
    if (path.startsWith('/v1/me/')) {
      const userToken = this.options.getUserToken()
      if (userToken === null) throw new CoreError('NOT_SIGNED_IN', 'Giriş yapılmamış.')
      headers['Music-User-Token'] = userToken
    }

    if (write?.body !== undefined) headers['Content-Type'] = 'application/json'
    const timeout = AbortSignal.timeout(this.timeoutMs)
    let current = url
    for (let hop = 0; ; hop++) {
      let res: Response
      try {
        res = await this.fetchImpl(current, {
          headers,
          redirect: 'manual',
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
          ...(write
            ? {
                method: write.method,
                ...(write.body !== undefined ? { body: JSON.stringify(write.body) } : {})
              }
            : {})
        })
      } catch (cause) {
        if (signal?.aborted) throw cancelled()
        throw new CoreError('OFFLINE', "Apple Music'e ulaşılamadı.", { cause })
      }
      if (!REDIRECT_STATUSES.has(res.status)) return res
      await res.body?.cancel()
      const next = sameOriginRedirect(res.headers.get('location'), current)
      if (write || !next || hop >= MAX_REDIRECTS) {
        // Hedef loglanmaz (sorgu kişisel veri taşıyabilir); yalnızca durum kodu.
        throw new CoreError(
          'API_REQUEST_FAILED',
          `Apple Music API beklenmeyen yönlendirme (HTTP ${res.status}).`,
          { status: res.status }
        )
      }
      current = next
    }
  }
}

/** Yönlendirme hedefi Apple API'nin kendi origin'indeyse çözümlenmiş URL, değilse `null`. */
function sameOriginRedirect(location: string | null, from: URL): URL | null {
  if (!location) return null
  try {
    const next = new URL(location, from)
    return next.origin === new URL(API_BASE_URL).origin && !next.username && !next.password
      ? next
      : null
  } catch {
    return null
  }
}
