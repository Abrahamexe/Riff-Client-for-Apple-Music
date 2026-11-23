import type { Db } from '../connection'

// sync_meta: her kapsamın (ör. "playlists", "playlistTracks:p.1") son senkronizasyon zamanı ve
// içerik özeti. Özet, arka plan senkronizasyonunda "değişti mi?" kararı için kullanılır.

export interface SyncMeta {
  syncedAt: number
  contentHash: string
  itemCount: number
}

export class SyncMetaRepository {
  constructor(private readonly db: Db) {}

  get(scope: string): SyncMeta | null {
    const row = this.db
      .prepare('SELECT synced_at, content_hash, item_count FROM sync_meta WHERE scope = ?')
      .get(scope) as { synced_at: number; content_hash: string; item_count: number } | undefined
    return row
      ? { syncedAt: row.synced_at, contentHash: row.content_hash, itemCount: row.item_count }
      : null
  }

  set(scope: string, meta: SyncMeta): void {
    this.db
      .prepare(
        `INSERT INTO sync_meta (scope, synced_at, content_hash, item_count) VALUES (?, ?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET synced_at = excluded.synced_at,
           content_hash = excluded.content_hash, item_count = excluded.item_count`
      )
      .run(scope, meta.syncedAt, meta.contentHash, meta.itemCount)
  }

  /** Kapsamı eski sayar: sonraki okuma yeniden senkronize eder (içerik özeti korunur). */
  invalidate(scope: string): void {
    this.db.prepare('UPDATE sync_meta SET synced_at = 0 WHERE scope = ?').run(scope)
  }

  /** Artık var olmayan playlist'lerin kayıtlarını siler. */
  deleteWherePrefixNotIn(prefix: string, keep: readonly string[]): void {
    this.db
      .prepare(
        `DELETE FROM sync_meta WHERE substr(scope, 1, length(?1)) = ?1
           AND scope NOT IN (SELECT ?1 || value FROM json_each(?2))`
      )
      .run(prefix, JSON.stringify(keep))
  }

  clear(): void {
    this.db.exec('DELETE FROM sync_meta')
  }
}
