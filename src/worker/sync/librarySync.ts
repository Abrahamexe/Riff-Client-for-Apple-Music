import { createHash } from 'node:crypto'
import type {
  Album,
  Artist,
  LibraryScope,
  LibrarySort,
  Playlist,
  Track,
  PlaylistSort
} from '@shared/ipc-contract'
import { CoreError, toCoreError } from '@shared/errors'
import type { AppleMusicApi } from '../net/appleApi'
import type { LibraryRepository } from '../db/repositories/library'
import type { LibraryCollectionsRepository } from '../db/repositories/libraryCollections'
import type { SyncMetaRepository } from '../db/repositories/syncMeta'

// Stale-while-revalidate (PLAN §3, 1.7a): okumalar HER ZAMAN yerel DB'den anında döner; veri yoksa
// veya eskiyse arka planda Apple ile senkronize edilir, içerik değiştiyse `onChanged` bildirilir.
// Ağ yoksa yerel veri kullanılmaya devam eder (`onError` ile bildirilir, okuma başarısız olmaz).

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_RANGE_LIMIT = 100

export interface LibrarySyncDeps {
  api: Pick<
    AppleMusicApi,
    | 'getPlaylists'
    | 'getPlaylistTracks'
    | 'getLibrarySongs'
    | 'getLibraryAlbums'
    | 'getLibraryArtists'
    | 'isSignedIn'
  >
  library: LibraryRepository
  /** Kütüphane bölümleri (Şarkılar, Albümler, Sanatçılar). */
  collections?: LibraryCollectionsRepository
  meta: SyncMetaRepository
  onChanged: (scope: LibraryScope) => void
  onError: (scope: LibraryScope, error: CoreError) => void
  now?: () => number
  /** Sabit veya her okumada sorulan (ince ayar: arşiv senkron süresi). */
  ttlMs?: number | (() => number)
  /**
   * Çakışma kuralı (3.B2): kapsamda bekleyen/yeni tamamlanmış yerel yazma varsa senkronizasyon
   * sonucu yazılmaz (Apple değişikliği geç yansıtabilir; iyimser durum ezilmesin). Anahtar: `keyOf`.
   */
  isHeld?: (key: string) => boolean
}

const PLAYLISTS_KEY = 'playlists'
const TRACKS_PREFIX = 'playlistTracks:'
export const keyOf = (s: LibraryScope): string =>
  s.scope === 'playlistTracks' ? `${TRACKS_PREFIX}${s.playlistId}` : s.scope

const hashOf = (items: readonly (Playlist | Track | Album | Artist)[]): string =>
  createHash('sha256').update(JSON.stringify(items)).digest('hex')

export class LibrarySync {
  private readonly now: () => number
  private readonly ttlMs: () => number
  private readonly inFlight = new Map<string, Promise<{ changed: boolean }>>()
  /** `clear()` sonrası, önceden başlamış senkronizasyonun eski hesabın verisini yazmasını engeller. */
  private generation = 0

  constructor(private readonly deps: LibrarySyncDeps) {
    this.now = deps.now ?? Date.now
    const ttl = deps.ttlMs ?? DEFAULT_TTL_MS
    this.ttlMs = typeof ttl === 'function' ? ttl : () => ttl
  }

  getPlaylists(): { items: Playlist[]; syncedAt: number | null } {
    const scope: LibraryScope = { scope: 'playlists' }
    const syncedAt = this.revalidateIfStale(scope)
    return { items: this.deps.library.listPlaylists(), syncedAt }
  }

  getPlaylistTracks(
    playlistId: string,
    offset = 0,
    limit = DEFAULT_RANGE_LIMIT,
    sort?: PlaylistSort
  ): { items: Track[]; offset: number; total: number; syncedAt: number | null } {
    const syncedAt = this.revalidateIfStale({ scope: 'playlistTracks', playlistId })
    return {
      items: this.deps.library.playlistTracks(playlistId, offset, limit, sort),
      offset,
      total: this.deps.library.countPlaylistTracks(playlistId),
      syncedAt
    }
  }

  getLibrarySongs(offset = 0, limit = DEFAULT_RANGE_LIMIT, sort?: LibrarySort) {
    return this.collectionPage({ scope: 'songs' }, 'library_song', offset, (c) =>
      c.songs(offset, limit, sort)
    )
  }

  getLibraryAlbums(offset = 0, limit = DEFAULT_RANGE_LIMIT, sort?: LibrarySort) {
    return this.collectionPage({ scope: 'albums' }, 'library_album', offset, (c) =>
      c.albums(offset, limit, sort)
    )
  }

  getLibraryArtists(offset = 0, limit = DEFAULT_RANGE_LIMIT, sort?: LibrarySort) {
    return this.collectionPage({ scope: 'artists' }, 'library_artist', offset, (c) =>
      c.artists(offset, limit, sort)
    )
  }

  // --- §3.6 Türler, Besteciler, Derlemeler (şarkı / albüm senkronundan; SWR aynı) ------------------

  getLibraryGenres(): { items: { name: string; count: number }[]; syncedAt: number | null } {
    const syncedAt = this.revalidateIfStale({ scope: 'songs' })
    return { items: this.requireCollections().genres(), syncedAt }
  }

  getLibraryComposers(): { items: { name: string; count: number }[]; syncedAt: number | null } {
    const syncedAt = this.revalidateIfStale({ scope: 'songs' })
    return { items: this.requireCollections().composers(), syncedAt }
  }

  getFilteredSongs(
    filter: { genre: string } | { composer: string },
    offset = 0,
    limit = DEFAULT_RANGE_LIMIT,
    sort?: LibrarySort
  ) {
    const syncedAt = this.revalidateIfStale({ scope: 'songs' })
    const page = this.requireCollections().filteredSongs(filter, offset, limit, sort)
    return { ...page, offset, syncedAt }
  }

  getLibraryCompilations(offset = 0, limit = DEFAULT_RANGE_LIMIT, sort?: LibrarySort) {
    const syncedAt = this.revalidateIfStale({ scope: 'albums' })
    const page = this.requireCollections().compilations(offset, limit, sort)
    return { ...page, offset, syncedAt }
  }

  private collectionPage<T>(
    scope: LibraryScope,
    table: 'library_song' | 'library_album' | 'library_artist',
    offset: number,
    read: (c: LibraryCollectionsRepository) => T[]
  ): { items: T[]; offset: number; total: number; syncedAt: number | null } {
    const collections = this.requireCollections()
    const syncedAt = this.revalidateIfStale(scope)
    return { items: read(collections), offset, total: collections.count(table), syncedAt }
  }

  private requireCollections(): LibraryCollectionsRepository {
    if (!this.deps.collections)
      throw new CoreError('INTERNAL', 'Kütüphane bölümleri yapılandırılmadı.')
    return this.deps.collections
  }

  /** Zorla senkronize eder. Aynı kapsam için eşzamanlı çağrılar tek işlemi paylaşır. */
  sync(scope: LibraryScope): Promise<{ changed: boolean }> {
    const key = keyOf(scope)
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const run = this.syncOnce(scope)
      .then((result) => {
        if (result.changed) this.deps.onChanged(scope)
        return result
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, run)
    return run
  }

  /** Çıkış: tüm yerel kütüphane verisi silinir; süren senkronizasyonlar sonucu yazmaz. */
  clear(): void {
    this.generation++
    this.deps.library.clear()
    this.deps.collections?.clear()
    this.deps.meta.clear()
  }

  /** Son senkronizasyon zamanını döner; veri yoksa/eskiyse arka planda senkronizasyon başlatır. */
  private revalidateIfStale(scope: LibraryScope): number | null {
    const meta = this.deps.meta.get(keyOf(scope))
    const fresh = meta !== null && this.now() - meta.syncedAt < this.ttlMs()
    if (!fresh && this.deps.api.isSignedIn()) {
      this.sync(scope).catch((err: unknown) =>
        this.deps.onError(scope, toCoreError(err, 'UNKNOWN', 'Senkronizasyon başarısız oldu.'))
      )
    }
    return meta?.syncedAt ?? null
  }

  private async syncOnce(scope: LibraryScope): Promise<{ changed: boolean }> {
    const generation = this.generation
    const { library } = this.deps

    if (scope.scope === 'songs' || scope.scope === 'albums' || scope.scope === 'artists') {
      const collections = this.requireCollections()
      const key = keyOf(scope)
      // A4: büyük liste parça parça yazılır; arada çıkış yapılırsa veya kapsamda yerel yazma
      // başlarsa yazma bırakılır (eski veri kalır).
      const options = {
        isCurrent: () => generation === this.generation && !(this.deps.isHeld?.(key) ?? false)
      }
      if (scope.scope === 'songs') {
        const items = await this.deps.api.getLibrarySongs()
        if (generation !== this.generation) return { changed: false }
        return this.store(key, items, () => collections.replaceSongs(items, options))
      }
      if (scope.scope === 'albums') {
        const items = await this.deps.api.getLibraryAlbums()
        if (generation !== this.generation) return { changed: false }
        return this.store(key, items, () => collections.replaceAlbums(items, options))
      }
      const items = await this.deps.api.getLibraryArtists()
      if (generation !== this.generation) return { changed: false }
      return this.store(key, items, () => collections.replaceArtists(items, options))
    }

    if (scope.scope === 'playlists') {
      const playlists = await this.deps.api.getPlaylists()
      if (generation !== this.generation) return { changed: false }
      return this.store(PLAYLISTS_KEY, playlists, () => {
        library.replacePlaylists(playlists)
        this.deps.meta.deleteWherePrefixNotIn(
          TRACKS_PREFIX,
          playlists.map((p) => p.id)
        )
      })
    }

    const { playlistId } = scope
    if (!library.hasPlaylist(playlistId)) await this.sync({ scope: 'playlists' })
    if (!library.hasPlaylist(playlistId)) {
      throw new CoreError('PLAYLIST_NOT_FOUND', 'Playlist kütüphanede bulunamadı.')
    }
    const tracks = await this.deps.api.getPlaylistTracks(playlistId)
    // Beklerken çıkış yapılmış veya playlist silinmiş olabilir.
    if (generation !== this.generation || !library.hasPlaylist(playlistId)) {
      return { changed: false }
    }
    // P5: büyük playlist parça parça; arada çıkış / yerel yazma olursa bırakılır.
    const key = keyOf(scope)
    return this.store(key, tracks, () =>
      library.replacePlaylistTracksChunked(playlistId, tracks, {
        isCurrent: () => generation === this.generation && !(this.deps.isHeld?.(key) ?? false)
      })
    )
  }

  /** `write` `false` dönerse (parçalı yazma bırakıldı) meta güncellenmez: sonra yeniden denenir. */
  private async store(
    key: string,
    items: readonly (Playlist | Track | Album | Artist)[],
    write: () => void | Promise<boolean>
  ): Promise<{ changed: boolean }> {
    if (this.deps.isHeld?.(key)) return { changed: false }
    const contentHash = hashOf(items)
    const changed = this.deps.meta.get(key)?.contentHash !== contentHash
    if (changed && (await write()) === false) return { changed: false }
    this.deps.meta.set(key, { syncedAt: this.now(), contentHash, itemCount: items.length })
    return { changed }
  }
}
