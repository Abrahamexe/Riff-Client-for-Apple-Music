import type { Locale } from '@shared/i18n'
import type {
  AlbumDetail,
  Artist,
  ArtistDetail,
  Card,
  CardGroup,
  Genre,
  PlaylistDetail,
  SongLinks,
  Track
} from '@shared/ipc-contract'
import type { AppleMusicApi } from '../net/appleApi'
import type { CatalogCacheRepository } from '../db/repositories/catalogCache'
import { matchArtist, matchSong } from './infoMedia'

// Katalog sayfaları (arayüz veri kapsamı): albüm, sanatçı, katalog playlist'i, Ana Sayfa önerileri,
// Göz At listeleri, Radyo istasyonları, son eklenenler. Ağdan okunur (Apple Music de çevrimiçi
// gösterir); aynı sayfaya dönüşte ağ beklenmesin diye kısa süre bellekte tutulur. Eşzamanlı aynı
// istek tek ağ isteğini paylaşır; hata önbelleğe alınmaz. Öneriler kişiseldir → çıkışta silinir.

const MIN = 60_000
export const CATALOG_TTL = {
  detail: 10 * MIN,
  recommendations: 15 * MIN,
  heavyRotation: 15 * MIN,
  charts: 30 * MIN,
  stations: 30 * MIN,
  /** Tür listeleri nadiren değişir. */
  genres: 6 * 60 * MIN,
  /** Son dinlenen istasyonlar kişisel ve sık değişir. */
  recentStations: 2 * MIN,
  recentlyAdded: 1 * MIN
} as const
/** Kalıcı kayıt biçim sürümü (Card / CardGroup / Genre şekli değişirse artırılır). */
const PERSIST_VERSION = 1
/** Bellekteki en fazla sayfa (en eskisi atılır). */
const MAX_ENTRIES = 200

type CatalogApi = Pick<
  AppleMusicApi,
  | 'getAlbum'
  | 'getArtist'
  | 'getCatalogPlaylist'
  | 'getRecommendations'
  | 'getHeavyRotation'
  | 'getCharts'
  | 'getGenres'
  | 'getLiveStations'
  | 'getRecentStations'
  | 'getStationGenres'
  | 'getGenreStations'
  | 'getRecentlyAdded'
  | 'getSongLinks'
  | 'searchGroups'
>

/** Bilgi paneli görsel aramasında aynı anda en fazla bu kadar Apple isteği. */
const MEDIA_CONCURRENCY = 4

export class CatalogService {
  private readonly cache = new Map<string, { until: number; value: Promise<unknown> }>()
  private generation = 0

  /** Süresi geçmiş kalıcı kaydı tazeleyen istekler (aynı anahtar için tek istek). */
  private readonly refreshing = new Set<string>()

  constructor(
    private readonly api: CatalogApi,
    private readonly now: () => number = Date.now,
    /** R2: liste sayfalarının kalıcı önbelleği (yoksa yalnızca bellek). */
    private readonly store?: Pick<CatalogCacheRepository, 'get' | 'put' | 'clear'>,
    /** Kalıcı kayıt arka planda tazelendi ve değişti: açık sayfalar yeniden okusun. */
    private readonly onRefreshed?: () => void
  ) {}

  getAlbum(id: string, locale?: Locale): Promise<AlbumDetail> {
    return this.memo(`album:${id}:${locale ?? ''}`, CATALOG_TTL.detail, () =>
      this.api.getAlbum(id, locale)
    )
  }

  getArtist(id: string, locale?: Locale): Promise<ArtistDetail> {
    return this.memo(`artist:${id}:${locale ?? ''}`, CATALOG_TTL.detail, () =>
      this.api.getArtist(id, locale)
    )
  }

  /** Bilgi paneli: adla sanatçı (fotoğraf için); yalnızca birebir eşleşme, yoksa `null`. */
  findArtist(name: string): Promise<Artist | null> {
    return this.memo(`artistByName:${name.toLowerCase()}`, CATALOG_TTL.detail, async () =>
      matchArtist(name, (await this.api.searchGroups('catalog', name, 5)).artists)
    )
  }

  /** Bilgi paneli: ad + sanatçıyla şarkı (sample'ın kapağı için); güvenli eşleşme yoksa `null`. */
  findSong(title: string, artist: string): Promise<Track | null> {
    const key = `songByName:${title.toLowerCase()}|${artist.toLowerCase()}`
    return this.memo(key, CATALOG_TTL.detail, async () =>
      matchSong(
        title,
        artist,
        (await this.api.searchGroups('catalog', `${title} ${artist}`, 5)).songs
      )
    )
  }

  /** Toplu arama (sıra korunur); tek tek hatalar `null` olur, toplam istek eşzamanlılığı sınırlı. */
  async lookupInfoMedia(
    artists: readonly string[],
    songs: readonly { title: string; artist: string }[]
  ): Promise<{ artists: (Artist | null)[]; songs: (Track | null)[] }> {
    const jobs: (() => Promise<unknown>)[] = [
      ...artists.map((n) => () => this.findArtist(n)),
      ...songs.map((s) => () => this.findSong(s.title, s.artist))
    ]
    const results: unknown[] = new Array(jobs.length).fill(null)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const i = next++
        results[i] = await jobs[i]!().catch(() => null)
      }
    }
    await Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, jobs.length) }, worker))
    return {
      artists: results.slice(0, artists.length) as (Artist | null)[],
      songs: results.slice(artists.length) as (Track | null)[]
    }
  }

  getSongLinks(id: string): Promise<SongLinks> {
    return this.memo(`songLinks:${id}`, CATALOG_TTL.detail, () => this.api.getSongLinks(id))
  }

  getCatalogPlaylist(id: string, locale?: Locale): Promise<PlaylistDetail> {
    return this.memo(`playlist:${id}:${locale ?? ''}`, CATALOG_TTL.detail, () =>
      this.api.getCatalogPlaylist(id, locale)
    )
  }

  getRecommendations(locale?: Locale): Promise<CardGroup[]> {
    return this.persisted(`recommendations:${locale ?? ''}`, CATALOG_TTL.recommendations, () =>
      this.api.getRecommendations(locale)
    )
  }

  getHeavyRotation(limit: number): Promise<Card[]> {
    return this.persisted(`heavyRotation:${limit}`, CATALOG_TTL.heavyRotation, () =>
      this.api.getHeavyRotation(limit)
    )
  }

  getCharts(limit: number, locale?: Locale, genre?: string): Promise<CardGroup[]> {
    return this.persisted(
      `charts:${limit}:${locale ?? ''}:${genre ?? ''}`,
      CATALOG_TTL.charts,
      () => this.api.getCharts(limit, locale, genre)
    )
  }

  getGenres(locale?: Locale): Promise<Genre[]> {
    return this.persisted(`genres:${locale ?? ''}`, CATALOG_TTL.genres, () =>
      this.api.getGenres(locale)
    )
  }

  getLiveStations(locale?: Locale): Promise<Card[]> {
    return this.persisted(`stations:${locale ?? ''}`, CATALOG_TTL.stations, () =>
      this.api.getLiveStations(locale)
    )
  }

  getRecentStations(limit: number, locale?: Locale): Promise<Card[]> {
    return this.persisted(
      `recentStations:${limit}:${locale ?? ''}`,
      CATALOG_TTL.recentStations,
      () => this.api.getRecentStations(limit, locale)
    )
  }

  getStationGenres(locale?: Locale): Promise<Genre[]> {
    return this.persisted(`stationGenres:${locale ?? ''}`, CATALOG_TTL.genres, () =>
      this.api.getStationGenres(locale)
    )
  }

  getGenreStations(id: string, locale?: Locale): Promise<Card[]> {
    return this.persisted(`genreStations:${id}:${locale ?? ''}`, CATALOG_TTL.stations, () =>
      this.api.getGenreStations(id, locale)
    )
  }

  getRecentlyAdded(limit: number): Promise<Card[]> {
    // Son Eklenenler kalıcı değil: sayfa tazelenme olayını dinlemiyor, eski liste kafa karıştırırdı.
    return this.memo(`recentlyAdded:${limit}`, CATALOG_TTL.recentlyAdded, () =>
      this.api.getRecentlyAdded(limit)
    )
  }

  /** Çıkış / hesap değişimi: kişisel sayfalar dahil her şey atılır; süren istek sonucu saklanmaz. */
  clear(): void {
    this.generation++
    this.cache.clear()
    this.refreshing.clear()
    this.store?.clear()
  }

  /**
   * Kalıcı SWR (R2): kayıt varsa diskten anında döner; süresi geçmişse arka planda tazelenir, içerik
   * değiştiyse `onRefreshed`. Kayıt yoksa ağdan okunur ve saklanır. Anahtar biçim sürümlüdür: veri
   * şekli değişirse `PERSIST_VERSION` artırılır, eski kayıtlar okunmaz.
   */
  private persisted<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const store = this.store
    if (!store) return this.memo(key, ttlMs, load)
    const hit = this.cache.get(key)
    if (hit && hit.until > this.now()) return hit.value as Promise<T>
    const storeKey = `${PERSIST_VERSION}:${key}`
    const generation = this.generation
    const save = (value: T): T => {
      if (generation === this.generation) store.put(storeKey, value, this.now())
      return value
    }
    const saved = store.get(storeKey)
    if (!saved) return this.memo(key, ttlMs, () => load().then(save))
    const value = Promise.resolve(saved.value as T)
    const age = this.now() - saved.fetchedAt
    this.cache.set(key, { until: this.now() + Math.max(0, ttlMs - age), value })
    if (age >= ttlMs && !this.refreshing.has(key)) {
      this.refreshing.add(key)
      load()
        .then((fresh) => {
          if (generation !== this.generation) return
          save(fresh)
          this.cache.set(key, { until: this.now() + ttlMs, value: Promise.resolve(fresh) })
          if (JSON.stringify(fresh) !== JSON.stringify(saved.value)) this.onRefreshed?.()
        })
        .catch(() => {
          // Ağ yok / hata: eski kayıt gösterilmeye devam eder; sonraki okumada yeniden denenir.
        })
        .finally(() => this.refreshing.delete(key))
    }
    return value
  }

  private memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key)
    if (hit && hit.until > this.now()) return hit.value as Promise<T>
    const generation = this.generation
    const value = load()
    this.cache.delete(key)
    this.cache.set(key, { until: this.now() + ttlMs, value })
    while (this.cache.size > MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    value.then(
      () => {
        if (generation !== this.generation) this.cache.delete(key)
      },
      () => {
        if (this.cache.get(key)?.value === value) this.cache.delete(key)
      }
    )
    return value
  }
}
