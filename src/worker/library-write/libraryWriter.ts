import { randomUUID } from 'node:crypto'
import type {
  LibraryIds,
  LibraryScope,
  Playlist,
  RatingKind,
  RatingValue,
  Track,
  WorkerEvent
} from '@shared/ipc-contract'
import { workerEventContract } from '@shared/ipc-contract'
import { CoreError, logError, toCoreError } from '@shared/errors'
import type { Db } from '../db/connection'
import type { LibraryRepository } from '../db/repositories/library'
import type { SyncMetaRepository } from '../db/repositories/syncMeta'
import type { AppleMusicApi, TrackRefBody } from '../net/appleApi'
import { keyOf } from '../sync/librarySync'

// Kütüphane yazma (PLAN 3.B2). Apple Music API'nin desteklediği yazma işlemleri:
//   kütüphaneye ekle · favorilere ekle · playlist oluştur · playlist'e şarkı ekle · sev/sevme.
// Desteklenmeyenler (Apple dokümanı, 2026-10-12): playlist silme/yeniden adlandırma, playlist'ten
// şarkı çıkarma, kütüphaneden silme, favorilerden çıkarma → kapsam dışı (docs/SETTINGS.md, 3.B2).
//
// Kurallar:
//  - İyimser: yerel DB anında güncellenir, `onLibraryChanged` gider. Apple reddederse (4xx) geri
//    alınır ve hata döner.
//  - Geçici hata (ağ yok, 429, 5xx) → işlem `pending_writes` kuyruğuna girer (`queued: true`), yerel
//    durum korunur. Kuyruk SIRAYLA gönderilir (yerel playlist'e ekleme, oluşturmadan sonra); kuyruk
//    boş değilken gelen yeni işlem de sona eklenir. `MAX_ATTEMPTS` sonra vazgeçilir → geri alma +
//    `onLibraryWriteFailed`.
//  - Çakışma: Apple esastır. Bekleyen veya yeni tamamlanmış (`SETTLE_MS`) yazması olan kapsamın
//    senkronizasyon sonucu yazılmaz (Apple değişikliği gecikmeli yansıtabilir — dokümanda "There may
//    be a delay"); süre dolunca kapsam eskimiş sayılır ve Apple'daki hal gelir.
//  - Yazma istekleri tekrar DENENMEZ (çoğalma riski); kuyruk aynı işlemi bir sonraki fırsatta yollar.

export const MAX_ATTEMPTS = 8
const SETTLE_MS = 30_000
const RETRY_INTERVAL_MS = 60_000
/** Henüz Apple'a ulaşmamış playlist'in yerel kimliği. */
export const LOCAL_PLAYLIST_PREFIX = 'local.'

type WriteApi = Pick<
  AppleMusicApi,
  | 'addToLibrary'
  | 'addToFavorites'
  | 'createPlaylist'
  | 'addTracksToPlaylist'
  | 'setRating'
  | 'getRatings'
  | 'isSignedIn'
>

/** Kuyruktaki işlemler (JSON). Geri alma için gereken yerel bilgi de taşınır. */
export type WriteOp =
  | { op: 'addToLibrary'; ids: LibraryIds }
  | { op: 'addToFavorites'; ids: LibraryIds; alsoAddToLibrary: boolean }
  | {
      op: 'createPlaylist'
      localId: string
      name: string
      description: string
      tracks: TrackRefBody[]
    }
  | {
      op: 'addTracks'
      playlistId: string
      tracks: TrackRefBody[]
      fromPosition: number
      /** "Playlist'e eklerken kütüphaneye ekle" açıksa eklenecek katalog id'leri. */
      libraryIds: string[]
    }
  | {
      op: 'setRating'
      kind: RatingKind
      id: string
      value: RatingValue
      previous: RatingValue
    }

export interface LibraryWriterDeps {
  db: Db
  api: WriteApi
  library: LibraryRepository
  meta: SyncMetaRepository
  emit: (event: WorkerEvent) => void
  now?: () => number
  settleMs?: number
  /** Kuyruk boş değilken periyodik yeniden deneme (test: 0 = kapalı). */
  retryIntervalMs?: number
}

const isTransient = (err: CoreError): boolean => err.retryable

/** Apple'a giden şarkı başvurusu: kütüphane id'si (`i.…`) → library-songs, diğerleri katalog. */
const trackRef = (t: Pick<Track, 'id'>): TrackRefBody => ({
  id: t.id,
  type: t.id.startsWith('i.') ? 'library-songs' : 'songs'
})

/** Kütüphaneye eklemek için katalog id'si (kütüphane öğesinin `catalogId`'si). */
const catalogIdOf = (t: Track): string | null =>
  t.playParams?.catalogId ?? (/^[0-9]{1,20}$/.test(t.id) ? t.id : null)

export class LibraryWriter {
  private readonly now: () => number
  private readonly settleMs: number
  /** Senkronizasyonda korunan kapsam → bitiş zamanı (yerel yazma sürüyor/yeni bitti). */
  private readonly settling = new Map<string, number>()
  /** Gönderimler sıraya dizilir: biri bitmeden diğeri başlamaz (kuyruk sırası korunur). */
  private flushChain: Promise<unknown> = Promise.resolve()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0

  constructor(private readonly deps: LibraryWriterDeps) {
    this.now = deps.now ?? Date.now
    this.settleMs = deps.settleMs ?? SETTLE_MS
  }

  /** LibrarySync `isHeld`: kuyrukta ilgili işlem var ya da yazma yeni bitti. */
  isHeld = (key: string): boolean => {
    const until = this.settling.get(key)
    if (until !== undefined) {
      if (this.now() < until) return true
      this.settling.delete(key)
      this.deps.meta.invalidate(key)
    }
    return this.pending().some((p) => this.scopesOf(p.op).includes(key))
  }

  async addToLibrary(ids: LibraryIds): Promise<{ queued: boolean }> {
    return this.run({ op: 'addToLibrary', ids })
  }

  async addToFavorites(ids: LibraryIds, alsoAddToLibrary = false): Promise<{ queued: boolean }> {
    return this.run({ op: 'addToFavorites', ids, alsoAddToLibrary })
  }

  async createPlaylist(
    name: string,
    description = '',
    tracks: readonly Track[] = []
  ): Promise<{ playlist: Playlist; queued: boolean }> {
    const local: Playlist = {
      id: `${LOCAL_PLAYLIST_PREFIX}${randomUUID()}`,
      name,
      description,
      canEdit: true,
      artworkUrl: null
    }
    const { library } = this.deps
    library.insertPlaylistFirst(local)
    if (tracks.length > 0) library.appendPlaylistTracks(local.id, tracks)
    this.changed({ scope: 'playlists' })
    const op: WriteOp = {
      op: 'createPlaylist',
      localId: local.id,
      name,
      description,
      tracks: tracks.map(trackRef)
    }
    const { queued, created } = await this.run(op)
    return { playlist: created ?? local, queued }
  }

  async addTracksToPlaylist(
    playlistId: string,
    tracks: readonly Track[],
    alsoAddToLibrary = false
  ): Promise<{ queued: boolean }> {
    const { library } = this.deps
    if (!library.hasPlaylist(playlistId)) {
      throw new CoreError('PLAYLIST_NOT_FOUND', 'Playlist kütüphanede bulunamadı.')
    }
    const fromPosition = library.appendPlaylistTracks(playlistId, tracks)
    this.changed({ scope: 'playlistTracks', playlistId })
    return this.run({
      op: 'addTracks',
      playlistId,
      tracks: tracks.map(trackRef),
      fromPosition,
      // "Playlist'e eklerken kütüphaneye ekle": yalnızca katalog id'si olan şarkılar.
      libraryIds: alsoAddToLibrary
        ? tracks.map(catalogIdOf).filter((id): id is string => id !== null)
        : []
    })
  }

  async setRating(kind: RatingKind, id: string, value: RatingValue): Promise<{ queued: boolean }> {
    const previous = this.localRating(kind, id)
    this.writeRating(kind, id, value)
    return this.run({ op: 'setRating', kind, id, value, previous })
  }

  /** Yerel puanlar; `refresh` ise Apple'dan okunup yerel kopya güncellenir (bekleyen yazma ezilmez). */
  async getRatings(
    kind: RatingKind,
    ids: readonly string[],
    refresh = false
  ): Promise<{ id: string; value: RatingValue }[]> {
    if (refresh && this.deps.api.isSignedIn()) {
      const remote = await this.deps.api.getRatings(kind, ids)
      const pendingIds = new Set(
        this.pending()
          .map((p) => p.op)
          .filter((o): o is Extract<WriteOp, { op: 'setRating' }> => o.op === 'setRating')
          .filter((o) => o.kind === kind)
          .map((o) => o.id)
      )
      for (const id of ids)
        if (!pendingIds.has(id)) this.writeRating(kind, id, remote.get(id) ?? null)
    }
    return ids.map((id) => ({ id, value: this.localRating(kind, id) }))
  }

  /** Kuyruğu sırayla gönderir; süren bir gönderim varsa o bittikten sonra çalışır. */
  flush(): Promise<{ sent: number; remaining: number }> {
    const run = this.flushChain.then(() => this.flushOnce())
    this.flushChain = run.catch(() => undefined)
    return run
  }

  /** Çıkış: kuyruk, puanlar ve korumalar silinir; süren işlemlerin sonucu yazılmaz. */
  clear(): void {
    this.generation++
    this.settling.clear()
    this.stopRetryTimer()
    this.deps.db.exec('DELETE FROM pending_writes; DELETE FROM ratings;')
  }

  dispose(): void {
    this.stopRetryTimer()
  }

  // --- iç işleyiş ------------------------------------------------------------------------------

  /**
   * Kuyruk boşsa hemen gönderir; geçici hatada kuyruğa alır; kalıcı hatada geri alıp fırlatır.
   * Kuyruk doluysa sıra korunur: sona eklenir ve gönderim denenir.
   */
  private async run(op: WriteOp): Promise<{ queued: boolean; created?: Playlist }> {
    if (this.pending().length > 0) {
      this.enqueue(op)
      void this.flush()
      return { queued: true }
    }
    const generation = this.generation
    for (const key of this.scopesOf(op)) this.settling.set(key, Infinity)
    try {
      const created = await this.execute(op)
      if (generation === this.generation) this.settle(op, created)
      return created ? { queued: false, created } : { queued: false }
    } catch (err) {
      const error = toCoreError(err, 'LIBRARY_WRITE_FAILED', 'Kütüphane yazması başarısız.')
      if (generation !== this.generation) throw error
      if (isTransient(error)) {
        this.release(op)
        this.enqueue(op)
        return { queued: true }
      }
      this.release(op)
      this.rollback(op)
      throw error
    }
  }

  /** İşlemi Apple'a gönderir; playlist oluşturulduysa Apple'ın verdiği playlist döner. */
  private async execute(op: WriteOp): Promise<Playlist | null> {
    const { api, library } = this.deps
    switch (op.op) {
      case 'addToLibrary':
        await api.addToLibrary(op.ids)
        break
      case 'addToFavorites':
        await api.addToFavorites(op.ids)
        if (op.alsoAddToLibrary) await api.addToLibrary(op.ids)
        break
      case 'createPlaylist': {
        const real = await api.createPlaylist(op.name, op.description, op.tracks)
        library.replacePlaylistId(op.localId, real)
        // Kuyrukta bu playlist'e bekleyen eklemeler varsa gerçek kimliğe taşınır.
        this.rewritePendingPlaylistId(op.localId, real.id)
        this.changed({ scope: 'playlists' })
        return real
      }
      case 'addTracks':
        // Yerel playlist'e ekleme kuyrukta oluşturmadan sonra gelir; oluşturma başarılı olunca
        // kimlik gerçek olanla değiştirilir (rewritePendingPlaylistId).
        if (op.playlistId.startsWith(LOCAL_PLAYLIST_PREFIX)) {
          throw new CoreError('OFFLINE', 'Playlist henüz Apple’a gönderilmedi.')
        }
        await api.addTracksToPlaylist(op.playlistId, op.tracks)
        if (op.libraryIds.length > 0) await api.addToLibrary({ songs: op.libraryIds })
        break
      case 'setRating':
        await api.setRating(op.kind, op.id, op.value)
        break
    }
    return null
  }

  private rollback(op: WriteOp): void {
    const { library } = this.deps
    switch (op.op) {
      case 'createPlaylist':
        library.deletePlaylist(op.localId)
        // Oluşturulamayan playlist'e bekleyen eklemeler de düşer (playlist artık yok).
        for (const p of this.pending()) {
          if (p.op.op === 'addTracks' && p.op.playlistId === op.localId) {
            this.deps.db.prepare('DELETE FROM pending_writes WHERE id = ?').run(p.id)
          }
        }
        this.changed({ scope: 'playlists' })
        break
      case 'addTracks':
        library.truncatePlaylistTracks(op.playlistId, op.fromPosition)
        this.changed({ scope: 'playlistTracks', playlistId: op.playlistId })
        break
      case 'setRating':
        this.writeRating(op.kind, op.id, op.previous)
        break
      default:
        break // kütüphane/favori eklemenin yerel karşılığı yok
    }
  }

  private async flushOnce(): Promise<{ sent: number; remaining: number }> {
    let sent = 0
    const generation = this.generation
    while (generation === this.generation && this.deps.api.isSignedIn()) {
      const next = this.pending()[0]
      if (!next) break
      try {
        const created = await this.execute(next.op)
        if (generation !== this.generation) break
        this.deps.db.prepare('DELETE FROM pending_writes WHERE id = ?').run(next.id)
        this.settle(next.op, created)
        sent++
      } catch (err) {
        if (generation !== this.generation) break
        const error = toCoreError(err, 'LIBRARY_WRITE_FAILED', 'Kütüphane yazması başarısız.')
        const attempts = next.attempts + 1
        if (isTransient(error) && attempts < MAX_ATTEMPTS) {
          this.deps.db
            .prepare('UPDATE pending_writes SET attempts = ? WHERE id = ?')
            .run(attempts, next.id)
          break // sıra korunur: sonraki fırsatta yeniden
        }
        // Kalıcı hata veya çok deneme: vazgeç, geri al, bildir.
        this.deps.db.prepare('DELETE FROM pending_writes WHERE id = ?').run(next.id)
        this.rollback(next.op)
        const failure = isTransient(error)
          ? new CoreError(
              'LIBRARY_WRITE_FAILED',
              `${next.op.op}: ${MAX_ATTEMPTS} denemede gönderilemedi.`
            )
          : error
        logError('library-write', failure)
        this.deps.emit({
          event: workerEventContract.onLibraryWriteFailed.event,
          payload: { op: next.op.op, error: failure.toWire() }
        })
      }
    }
    const remaining = this.pending().length
    if (remaining > 0) this.startRetryTimer()
    else this.stopRetryTimer()
    return { sent, remaining }
  }

  private pending(): { id: number; op: WriteOp; attempts: number }[] {
    const rows = this.deps.db
      .prepare('SELECT id, payload, attempts FROM pending_writes ORDER BY id')
      .all() as { id: number; payload: string; attempts: number }[]
    return rows.map((r) => ({
      id: r.id,
      op: JSON.parse(r.payload) as WriteOp,
      attempts: r.attempts
    }))
  }

  private enqueue(op: WriteOp): void {
    this.deps.db
      .prepare('INSERT INTO pending_writes (op, payload, created_at) VALUES (?, ?, ?)')
      .run(op.op, JSON.stringify(op), this.now())
    this.startRetryTimer()
  }

  private rewritePendingPlaylistId(localId: string, realId: string): void {
    for (const p of this.pending()) {
      if (p.op.op === 'addTracks' && p.op.playlistId === localId) {
        this.deps.db
          .prepare('UPDATE pending_writes SET payload = ? WHERE id = ?')
          .run(JSON.stringify({ ...p.op, playlistId: realId }), p.id)
      }
    }
  }

  /** İşlemin dokunduğu senkronizasyon kapsamları (LibrarySync anahtarı). */
  private scopesOf(op: WriteOp): string[] {
    switch (op.op) {
      case 'createPlaylist':
        return [
          keyOf({ scope: 'playlists' }),
          keyOf({ scope: 'playlistTracks', playlistId: op.localId })
        ]
      case 'addTracks':
        return [keyOf({ scope: 'playlistTracks', playlistId: op.playlistId })]
      case 'addToLibrary':
      case 'addToFavorites':
        return op.ids.playlists?.length ? [keyOf({ scope: 'playlists' })] : []
      default:
        return []
    }
  }

  /** Tamamlanan yazmanın kapsamları `settleMs` boyunca senkronizasyonda korunur. */
  private settle(op: WriteOp, created: Playlist | null): void {
    const until = this.now() + this.settleMs
    for (const key of this.scopesOf(op)) this.settling.set(key, until)
    if (created)
      this.settling.set(keyOf({ scope: 'playlistTracks', playlistId: created.id }), until)
  }

  private release(op: WriteOp): void {
    for (const key of this.scopesOf(op)) this.settling.delete(key)
  }

  private localRating(kind: RatingKind, id: string): RatingValue {
    const row = this.deps.db
      .prepare('SELECT value FROM ratings WHERE kind = ? AND id = ?')
      .get(kind, id) as { value: 1 | -1 } | undefined
    return row?.value ?? null
  }

  private writeRating(kind: RatingKind, id: string, value: RatingValue): void {
    if (value === null) {
      this.deps.db.prepare('DELETE FROM ratings WHERE kind = ? AND id = ?').run(kind, id)
    } else {
      this.deps.db
        .prepare(
          `INSERT INTO ratings (kind, id, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(kind, id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run(kind, id, value, this.now())
    }
  }

  private changed(scope: LibraryScope): void {
    this.deps.emit({ event: workerEventContract.onLibraryChanged.event, payload: scope })
  }

  /** Kuyruk boş değilken tek seferlik yeniden deneme (setInterval yok: enerji kuralı 1.8b). */
  private startRetryTimer(): void {
    const delay = this.deps.retryIntervalMs ?? RETRY_INTERVAL_MS
    if (this.retryTimer || delay <= 0) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delay)
    this.retryTimer.unref?.()
  }

  private stopRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}
