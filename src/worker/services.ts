import type { TrackRef } from '@shared/background'
import { CoreError } from '@shared/errors'
import type { LibraryScope, WorkerEvent } from '@shared/ipc-contract'
import { workerEventContract } from '@shared/ipc-contract'
import type { BackgroundService } from './background/service'
import { wipeFreeSpace, type Db } from './db/connection'
import { LibraryRepository } from './db/repositories/library'
import { LibraryCollectionsRepository } from './db/repositories/libraryCollections'
import { CatalogService } from './catalog/catalogService'
import { PlayerStateRepository } from './db/repositories/playerState'
import { SyncMetaRepository } from './db/repositories/syncMeta'
import type { AppleMusicApi } from './net/appleApi'
import type { IsrcResolver } from './net/isrcResolver'
import type { WorkerHandlers } from './rpc'
import { LibraryWriter } from './library-write/libraryWriter'
import { SearchService } from './search/searchService'
import { SettingsService } from './settings/settingsService'
import { CatalogCacheRepository } from './db/repositories/catalogCache'
import type { Settings } from '@shared/settings'
import { LibrarySync } from './sync/librarySync'

// Worker'ın renderer'a sunduğu yöntemler (sözleşme: shared/ipc-contract.ts → workerContract).

export interface WorkerServicesDeps {
  db: Db
  api: AppleMusicApi
  /** Bağlı tüm renderer'lara bildirim yollar. */
  emit: (event: WorkerEvent) => void
  /** Müzik arka planı katmanı (PLAN 3.A7). */
  background: Pick<BackgroundService, 'get' | 'prefetch' | 'clear' | 'lyrics' | 'prefetchLyrics'>
  /** Güvenli mod (PLAN 2.3): açıkken arka plan istekleri reddedilir, ön yükleme yapılmaz. */
  isSafeMode?: () => boolean
  /**
   * Kullanıcı token'ı var mı (2.7 Y2). Yokken (giriş yok / çıkış yapıldı) kullanıcıya ait hiçbir şey
   * yazılmaz: player durumu kaydı yoksayılır, arka plan istekleri reddedilir. Çıkıştan sonra gelen
   * gecikmiş kayıtlar (durma olayı, kapanıştaki flush, ön yükleme) silinen veriyi geri yazamaz.
   */
  isSignedIn?: () => boolean
  /** Katalog id → ISRC (V8). Verilmezse arka plan istekleri olduğu gibi gider. */
  isrc?: Pick<IsrcResolver, 'resolve' | 'clear'>
  now?: () => number
  ttlMs?: number
  /** Ayarlar açılışta ve her değişiklikte (Hızlı DNS gibi süreç düzeyi ayarlar için). */
  onSettings?: (settings: Settings) => void
  /** Test: LibraryWriter zamanlamaları. */
  writerOptions?: { settleMs?: number; retryIntervalMs?: number }
}

export interface WorkerServices {
  handlers: WorkerHandlers
  /**
   * Çıkış: kütüphane, senkronizasyon kayıtları, player durumu ve arka plan cache'leri silinir
   * (PLAN 1.5, 2.5).
   */
  clearUserData(): void
  /** Oturum token'ı geldi (açılış / giriş): önceki oturumdan kalan yazma kuyruğu gönderilir. */
  onSignedIn(): void
}

export function createWorkerServices({
  db,
  api,
  emit,
  background,
  isrc,
  isSafeMode = () => false,
  isSignedIn = () => true,
  now,
  ttlMs,
  onSettings,
  writerOptions
}: WorkerServicesDeps): WorkerServices {
  /** Yazma işlemleri yalnızca oturum varken (çıkıştan sonra yerel veri yeniden oluşmasın). */
  const signedIn = <T>(fn: () => Promise<T>): Promise<T> =>
    isSignedIn()
      ? fn()
      : Promise.reject(new CoreError('NOT_SIGNED_IN', 'Kütüphane değişikliği için giriş yapın.'))
  /** ISRC yoksa ve katalog id'si varsa Apple'dan çözülen ISRC eklenir (cache anahtarı tutarlı kalır). */
  const withIsrc = async (track: TrackRef): Promise<TrackRef> => {
    if (track.isrc || !track.appleId || !isrc) return track
    const found = await isrc.resolve(track.appleId)
    return found ? { ...track, isrc: found } : track
  }
  const player = new PlayerStateRepository(db, now)
  const search = new SearchService(db, api, now)
  const settings = new SettingsService(db, emit)
  // İnce ayar: arşiv senkron süresi. Bellekte tutulur (her sayfa okumasında ayar okunmasın).
  let syncTtlMs = settings.get().tweaks.librarySyncMinutes * 60_000
  onSettings?.(settings.get())
  const library = new LibraryRepository(db)
  const meta = new SyncMetaRepository(db)
  const writer = new LibraryWriter({ db, api, library, meta, emit, now, ...writerOptions })
  // R2: liste sayfaları (Ana Sayfa, Yeni, Radyo) diskte; tazelenince açık sayfalar yeniden okur.
  const catalog = new CatalogService(api, now, new CatalogCacheRepository(db), () =>
    emit({ event: workerEventContract.onCatalogRefreshed.event, payload: {} })
  )
  const sync = new LibrarySync({
    api,
    library,
    collections: new LibraryCollectionsRepository(db),
    meta,
    now,
    ttlMs: ttlMs ?? (() => syncTtlMs),
    isHeld: writer.isHeld,
    onChanged: (scope: LibraryScope) =>
      emit({ event: workerEventContract.onLibraryChanged.event, payload: scope }),
    onError: (target, error) =>
      emit({
        event: workerEventContract.onSyncError.event,
        payload: { target, error: error.toWire() }
      })
  })

  const handlers: WorkerHandlers = {
    getPlaylists: () => sync.getPlaylists(),
    getPlaylistTracks: ({ playlistId, offset, limit, sort }) =>
      sync.getPlaylistTracks(playlistId, offset, limit, sort),
    syncLibrary: (scope) => sync.sync(scope),
    getRecentlyPlayed: ({ limit }) => api.getRecentlyPlayed(limit),
    searchCatalog: ({ term, limit, storefront }) => api.searchCatalog(term, limit, storefront),
    searchLibrary: ({ term, limit }) => api.searchLibrary(term, limit),
    search: (params) => search.search(params),
    searchSuggestions: (params) => search.suggest(params),
    getRecentSearches: ({ limit }) => search.recent(limit),
    addRecentSearch: ({ term }) => {
      if (isSignedIn()) search.addRecent(term)
      return null
    },
    clearRecentSearches: () => {
      search.clear()
      return null
    },
    addToLibrary: (ids) => signedIn(() => writer.addToLibrary(ids)),
    addToFavorites: ({ ids, alsoAddToLibrary }) =>
      signedIn(() => writer.addToFavorites(ids, alsoAddToLibrary)),
    createPlaylist: ({ name, description, tracks }) =>
      signedIn(() => writer.createPlaylist(name, description, tracks)),
    addTracksToPlaylist: ({ playlistId, tracks, alsoAddToLibrary }) =>
      signedIn(() => writer.addTracksToPlaylist(playlistId, tracks, alsoAddToLibrary)),
    setRating: ({ kind, id, value }) => signedIn(() => writer.setRating(kind, id, value)),
    getRatings: ({ kind, ids, refresh }) => writer.getRatings(kind, ids, refresh),
    flushPendingWrites: () => writer.flush(),
    getLibrarySongs: ({ offset, limit, sort }) => sync.getLibrarySongs(offset, limit, sort),
    getLibraryAlbums: ({ offset, limit, sort }) => sync.getLibraryAlbums(offset, limit, sort),
    getLibraryArtists: ({ offset, limit, sort }) => sync.getLibraryArtists(offset, limit, sort),
    getLibraryGenres: () => sync.getLibraryGenres(),
    getLibraryComposers: () => sync.getLibraryComposers(),
    getFilteredSongs: ({ genre, composer, offset, limit, sort }) => {
      if ((genre === undefined) === (composer === undefined)) {
        throw new CoreError('INVALID_ARGUMENT', 'Tür ya da besteciden tam olarak biri verilmeli.')
      }
      return sync.getFilteredSongs(
        genre !== undefined ? { genre } : { composer: composer! },
        offset,
        limit,
        sort
      )
    },
    getLibraryCompilations: ({ offset, limit, sort }) =>
      sync.getLibraryCompilations(offset, limit, sort),
    getRecentlyAdded: ({ limit }) => catalog.getRecentlyAdded(limit ?? 25),
    getAlbum: ({ id, locale }) => catalog.getAlbum(id, locale),
    getSongLinks: ({ id }) => catalog.getSongLinks(id),
    lookupInfoMedia: ({ artists, songs }) => catalog.lookupInfoMedia(artists, songs),
    getArtist: ({ id, locale }) => catalog.getArtist(id, locale),
    getCatalogPlaylist: ({ id, locale }) => catalog.getCatalogPlaylist(id, locale),
    getRecommendations: ({ locale }) => catalog.getRecommendations(locale),
    getHeavyRotation: ({ limit }) => catalog.getHeavyRotation(limit ?? 20),
    getCharts: ({ limit, locale, genre }) => catalog.getCharts(limit ?? 20, locale, genre),
    getGenres: ({ locale }) => catalog.getGenres(locale),
    getLiveStations: ({ locale }) => catalog.getLiveStations(locale),
    getRecentStations: ({ limit, locale }) => catalog.getRecentStations(limit ?? 20, locale),
    getStationGenres: ({ locale }) => catalog.getStationGenres(locale),
    getGenreStations: ({ id, locale }) => catalog.getGenreStations(id, locale),
    getSettings: () => settings.get(),
    updateSettings: (patch) => {
      const next = settings.update(patch)
      syncTtlMs = next.tweaks.librarySyncMinutes * 60_000
      onSettings?.(next)
      return next
    },
    clearBackgroundCache: () => {
      background.clear()
      return null
    },
    probeLibraryAccess: () => api.probeLibraryAccess(),
    savePlayerState: (state) => {
      if (isSignedIn()) player.save(state)
      return null
    },
    loadPlayerState: () => player.load(),
    getBackground: async ({ track, lang, requestId }) => {
      if (isSafeMode()) {
        throw new CoreError('SAFE_MODE_ENABLED', 'Güvenli mod: müzik arka planı kapalı.')
      }
      if (!isSignedIn()) throw new CoreError('NOT_SIGNED_IN', 'Giriş yapılmamış.')
      return background.get(await withIsrc(track), lang, requestId)
    },
    getLyrics: ({ track }) => {
      if (isSafeMode()) {
        return Promise.reject(new CoreError('SAFE_MODE_ENABLED', 'Güvenli mod: sözler kapalı.'))
      }
      if (!isSignedIn()) return Promise.reject(new CoreError('NOT_SIGNED_IN', 'Giriş yapılmamış.'))
      return background.lyrics(track)
    },
    prefetchLyrics: ({ track }) => {
      if (!isSafeMode() && isSignedIn()) background.prefetchLyrics(track)
      return null
    },
    prefetchBackground: async ({ track, lang }) => {
      if (!isSafeMode() && isSignedIn()) background.prefetch(await withIsrc(track), lang)
      return null
    }
  }

  return {
    handlers,
    clearUserData: () => {
      sync.clear()
      player.clear()
      search.clear()
      catalog.clear()
      writer.clear()
      settings.clearUserScoped()
      isrc?.clear()
      background.clear()
      wipeFreeSpace(db)
    },
    onSignedIn: () => void writer.flush()
  }
}
