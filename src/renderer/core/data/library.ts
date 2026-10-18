import type { Locale } from '@shared/i18n'
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  Card,
  CardGroup,
  Genre,
  SongLinks,
  LibraryIds,
  LibraryScope,
  LibrarySort,
  PlaylistDetail,
  PlayerState,
  Playlist,
  RatingKind,
  RatingValue,
  SearchResults,
  Track,
  WorkerApi,
  WorkerResult,
  PlaylistSort
} from '@shared/ipc-contract'
import type { IpcResult } from '@shared/types'
import { CoreError, fromWireError } from '../errors'
import { notifyUnauthorized } from '../musickit/guard'

// Kütüphane, playlist ve arama (PLAN 1.7 → 1.7a). Veri worker'dan gelir: okumalar yerel DB'den
// anında döner (SWR), senkronizasyon worker'da yapılır, değişiklik `onChanged` ile bildirilir.
// Renderer ağa doğrudan çıkmaz ve token görmez. UI'dan bağımsızdır.

export type { Playlist, SearchResults, Track }

export interface PlaylistsView {
  items: Playlist[]
  /** Son başarılı senkronizasyon (ms); hiç senkronize edilmediyse `null`. */
  syncedAt: number | null
}

export type TracksPage = WorkerResult<'getPlaylistTracks'>
export type { Album, AlbumDetail, Artist, ArtistDetail, Card, CardGroup, Genre, PlaylistDetail }

/** Kütüphane bölümü sayfası (SWR: `syncedAt` null → henüz senkronize edilmedi). */
export interface CollectionPage<T> {
  items: T[]
  offset: number
  total: number
  syncedAt: number | null
}
export interface CollectionRange {
  offset?: number
  limit?: number
  sort?: LibrarySort
}

export class LibraryClient {
  constructor(private readonly api: WorkerApi = window.api.worker) {}

  getPlaylists(): Promise<PlaylistsView> {
    return this.call(this.api.getPlaylists({}))
  }

  /** Aralıklı okuma: binlerce şarkılık playlist'ler parça parça (varsayılan 100) okunur. */
  getPlaylistTracks(
    playlistId: string,
    range: { offset?: number; limit?: number; sort?: PlaylistSort; query?: string } = {}
  ): Promise<TracksPage> {
    return this.call(this.api.getPlaylistTracks({ playlistId, ...range }))
  }

  // --- Arayüz veri kapsamı: kütüphane bölümleri (SWR) ve katalog sayfaları (ağ + kısa önbellek) --

  getLibrarySongs(range: CollectionRange = {}): Promise<CollectionPage<Track>> {
    return this.call(this.api.getLibrarySongs(range))
  }

  getLibraryAlbums(range: CollectionRange = {}): Promise<CollectionPage<Album>> {
    return this.call(this.api.getLibraryAlbums(range))
  }

  /** §3.6 Arşiv → Türler. */
  getLibraryGenres(): Promise<WorkerResult<'getLibraryGenres'>> {
    return this.call(this.api.getLibraryGenres({}))
  }

  /** §3.6 Arşiv → Besteciler (kişi kişi ayrılmış). */
  getLibraryComposers(): Promise<WorkerResult<'getLibraryComposers'>> {
    return this.call(this.api.getLibraryComposers({}))
  }

  /** §3.6: bir türün ya da bestecinin şarkıları. */
  getFilteredSongs(
    filter: { genre: string } | { composer: string },
    range: CollectionRange = {}
  ): Promise<CollectionPage<Track>> {
    return this.call(this.api.getFilteredSongs({ ...filter, ...range }))
  }

  /** §3.6 Arşiv → Derlemeler. */
  getLibraryCompilations(range: CollectionRange = {}): Promise<CollectionPage<Album>> {
    return this.call(this.api.getLibraryCompilations(range))
  }

  getLibraryArtists(range: CollectionRange = {}): Promise<CollectionPage<Artist>> {
    return this.call(this.api.getLibraryArtists(range))
  }

  getRecentlyAdded(limit?: number): Promise<Card[]> {
    return this.call(this.api.getRecentlyAdded(limit === undefined ? {} : { limit }))
  }

  /** Katalog (sayısal id) veya kütüphane (`l.…`) albümü. */
  getAlbum(id: string, locale?: Locale): Promise<AlbumDetail> {
    return this.call(this.api.getAlbum(locale === undefined ? { id } : { id, locale }))
  }

  /** Katalog (sayısal id) veya kütüphane (`r.…`) sanatçısı. */
  getArtist(id: string, locale?: Locale): Promise<ArtistDetail> {
    return this.call(this.api.getArtist(locale === undefined ? { id } : { id, locale }))
  }

  getCatalogPlaylist(id: string, locale?: Locale): Promise<PlaylistDetail> {
    return this.call(this.api.getCatalogPlaylist(locale === undefined ? { id } : { id, locale }))
  }

  /** Ana Sayfa: Apple'ın öneri rafları (`locale` dilinde başlıklar). */
  getRecommendations(locale?: Locale): Promise<CardGroup[]> {
    return this.call(this.api.getRecommendations(locale === undefined ? {} : { locale }))
  }

  /** Ana Sayfa: sık çalınanlar. */
  getHeavyRotation(limit?: number): Promise<Card[]> {
    return this.call(this.api.getHeavyRotation(limit === undefined ? {} : { limit }))
  }

  /** "Yeni": listeler (`genre` verilirse o türün). */
  getCharts(
    options: { limit?: number; locale?: Locale; genre?: string } = {}
  ): Promise<CardGroup[]> {
    return this.call(this.api.getCharts(options))
  }

  /** Şarkı menüsü: katalog şarkısının albümü ve sanatçısı. */
  getSongLinks(id: string): Promise<SongLinks> {
    return this.call(this.api.getSongLinks({ id }))
  }

  /** "Yeni": tür seçicisi. */
  getGenres(locale?: Locale): Promise<Genre[]> {
    return this.call(this.api.getGenres(locale === undefined ? {} : { locale }))
  }

  /** Radyo: canlı istasyonlar. */
  getLiveStations(locale?: Locale): Promise<Card[]> {
    return this.call(this.api.getLiveStations(locale === undefined ? {} : { locale }))
  }

  /** Radyo: son dinlenen istasyonlar. */
  getRecentStations(options: { limit?: number; locale?: Locale } = {}): Promise<Card[]> {
    return this.call(this.api.getRecentStations(options))
  }

  /** Radyo: istasyon türleri. */
  getStationGenres(locale?: Locale): Promise<Genre[]> {
    return this.call(this.api.getStationGenres(locale === undefined ? {} : { locale }))
  }

  /** Radyo: bir türün istasyonları. */
  getGenreStations(id: string, locale?: Locale): Promise<Card[]> {
    return this.call(this.api.getGenreStations(locale === undefined ? { id } : { id, locale }))
  }

  /** Arka planı beklemeden zorla senkronize eder. */
  sync(scope: LibraryScope): Promise<{ changed: boolean }> {
    return this.call(this.api.syncLibrary(scope))
  }

  getRecentlyPlayed(limit?: number): Promise<Track[]> {
    return this.call(this.api.getRecentlyPlayed(limit === undefined ? {} : { limit }))
  }

  /** `storefront` verilmezse worker kullanıcının hesabındakini kullanır. */
  searchCatalog(
    term: string,
    options: { limit?: number; storefront?: string } = {}
  ): Promise<SearchResults> {
    return this.call(this.api.searchCatalog({ term: requireTerm(term), ...options }))
  }

  /** Bilgi paneli görselleri: kişilerin ve sample şarkıların Apple Music karşılığı (sıra korunur). */
  lookupInfoMedia(
    artists: string[],
    songs: { title: string; artist: string }[]
  ): Promise<WorkerResult<'lookupInfoMedia'>> {
    return this.call(this.api.lookupInfoMedia({ artists, songs }))
  }

  /** Katalogda sanatçı adı araması (oynatıcıdaki sanatçı bağlantısının yedeği). */
  async searchArtists(name: string, limit = 5): Promise<Artist[]> {
    const res = await this.call(
      this.api.search({ term: requireTerm(name), scope: 'catalog', limit })
    )
    return res.catalog?.artists ?? []
  }

  searchLibrary(term: string, limit?: number): Promise<SearchResults> {
    const params = { term: requireTerm(term), ...(limit === undefined ? {} : { limit }) }
    return this.call(this.api.searchLibrary(params))
  }

  // --- Yazma (3.B2): iyimser; `queued` = çevrimdışı, bağlanınca gönderilecek -----------------

  addToLibrary(ids: LibraryIds): Promise<{ queued: boolean }> {
    return this.call(this.api.addToLibrary(ids))
  }

  addToFavorites(ids: LibraryIds, alsoAddToLibrary?: boolean): Promise<{ queued: boolean }> {
    return this.call(
      this.api.addToFavorites({
        ids,
        ...(alsoAddToLibrary === undefined ? {} : { alsoAddToLibrary })
      })
    )
  }

  createPlaylist(
    name: string,
    options: { description?: string; tracks?: Track[] } = {}
  ): Promise<{ playlist: Playlist; queued: boolean }> {
    return this.call(this.api.createPlaylist({ name, ...options }))
  }

  addTracksToPlaylist(
    playlistId: string,
    tracks: Track[],
    alsoAddToLibrary?: boolean
  ): Promise<{ queued: boolean }> {
    return this.call(
      this.api.addTracksToPlaylist({
        playlistId,
        tracks,
        ...(alsoAddToLibrary === undefined ? {} : { alsoAddToLibrary })
      })
    )
  }

  setRating(kind: RatingKind, id: string, value: RatingValue): Promise<{ queued: boolean }> {
    return this.call(this.api.setRating({ kind, id, value }))
  }

  getRatings(
    kind: RatingKind,
    ids: string[],
    refresh?: boolean
  ): Promise<{ id: string; value: RatingValue }[]> {
    return this.call(
      this.api.getRatings({ kind, ids, ...(refresh === undefined ? {} : { refresh }) })
    )
  }

  flushPendingWrites(): Promise<{ sent: number; remaining: number }> {
    return this.call(this.api.flushPendingWrites({}))
  }

  /** Kuyruktaki bir yazma sonradan başarısız oldu; yerel değişiklik geri alındı. */
  onWriteFailed(listener: (op: string, error: CoreError) => void): () => void {
    return this.api.onLibraryWriteFailed(({ op, error }) => listener(op, fromWireError(error)))
  }

  probeLibraryAccess(): Promise<number> {
    return this.call(this.api.probeLibraryAccess({}))
  }

  savePlayerState(state: PlayerState): Promise<void> {
    return this.call(this.api.savePlayerState(state)).then(() => undefined)
  }

  loadPlayerState(): Promise<PlayerState | null> {
    return this.call(this.api.loadPlayerState({}))
  }

  /** Arka plan senkronizasyonu yerel veriyi değiştirdi. Abonelikten çıkan fonksiyon döner. */
  onChanged(listener: (scope: LibraryScope) => void): () => void {
    return this.api.onLibraryChanged(listener)
  }

  /** Kalıcı katalog kaydı (Ana Sayfa, Yeni, Radyo) arka planda tazelendi (R2). */
  onCatalogRefreshed(listener: () => void): () => void {
    return this.api.onCatalogRefreshed(() => listener())
  }

  /** Arka plan senkronizasyonu başarısız (yerel veri kullanılmaya devam eder). */
  onSyncError(listener: (scope: LibraryScope, error: CoreError) => void): () => void {
    return this.api.onSyncError(({ target, error }) => {
      const e = fromWireError(error)
      if (e.code === 'UNAUTHORIZED') void notifyUnauthorized(e)
      listener(target, e)
    })
  }

  private async call<T>(request: Promise<IpcResult<T>>): Promise<T> {
    const res = await request
    if (res.ok) return res.value
    const error = fromWireError(res.error)
    if (error.code === 'UNAUTHORIZED') await notifyUnauthorized(error)
    throw error
  }
}

function requireTerm(term: string): string {
  const q = term.trim()
  if (q === '') throw new CoreError('INVALID_ARGUMENT', 'Arama terimi boş olamaz.')
  return q
}
