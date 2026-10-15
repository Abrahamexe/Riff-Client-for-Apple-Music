import type { Db } from '../db/connection'
import { entryBytes, TOUCH_GRANULARITY_MS, type WriteListener } from './cacheMaintenance'

// Dış kaynak yanıt cache'i (PLAN 3.A1), tablo `bg_http_cache` (migration 2). SourceClient tazeliği
// kaynağın TTL'ine göre hesaplar; burası yalnızca saklar. Çıkışta (PLAN 1.5, 2.5) silinir: hangi
// şarkıların arandığı dinleme geçmişini ele verebilir.

export interface CachedResponse {
  /** 200: gövde şemadan geçmiş JSON; 404: "bulunamadı" (gövde boş). */
  status: 200 | 404
  body: string
  fetchedAt: number
}

/** SourceClient'ın kullandığı yüzey (testte bellek içi uygulanabilir). */
export interface ResponseCache {
  get(key: string): CachedResponse | null
  set(key: string, source: string, entry: CachedResponse): void
}

export interface CacheStoreOptions {
  now?: () => number
  /** Her yazımda çağrılır (boyut yönetimi: PLAN 3.A8). */
  onWrite?: WriteListener
}

export class BackgroundHttpCache implements ResponseCache {
  private readonly now: () => number
  private readonly onWrite: WriteListener | undefined

  constructor(
    private readonly db: Db,
    { now, onWrite }: CacheStoreOptions = {}
  ) {
    this.now = now ?? Date.now
    this.onWrite = onWrite
  }

  get(key: string): CachedResponse | null {
    const row = this.db
      .prepare('SELECT status, body, fetched_at, last_access FROM bg_http_cache WHERE key = ?')
      .get(key) as
      { status: number; body: string; fetched_at: number; last_access: number } | undefined
    if (!row || (row.status !== 200 && row.status !== 404)) return null
    const now = this.now()
    if (now - row.last_access >= TOUCH_GRANULARITY_MS) {
      this.db.prepare('UPDATE bg_http_cache SET last_access = ? WHERE key = ?').run(now, key)
    }
    return { status: row.status, body: row.body, fetchedAt: row.fetched_at }
  }

  set(key: string, source: string, entry: CachedResponse): void {
    this.db
      .prepare(
        `INSERT INTO bg_http_cache (key, source, status, body, fetched_at, bytes, last_access)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET source = excluded.source, status = excluded.status,
           body = excluded.body, fetched_at = excluded.fetched_at, bytes = excluded.bytes,
           last_access = excluded.last_access`
      )
      .run(
        key,
        source,
        entry.status,
        entry.body,
        entry.fetchedAt,
        entryBytes(key, entry.body),
        this.now()
      )
    this.onWrite?.()
  }

  clear(): void {
    this.db.exec('DELETE FROM bg_http_cache')
  }
}

/** Bellek içi cache (testler ve DB'siz kullanım). */
export class MemoryResponseCache implements ResponseCache {
  readonly entries = new Map<string, CachedResponse & { source: string }>()

  get(key: string): CachedResponse | null {
    const entry = this.entries.get(key)
    return entry ? { status: entry.status, body: entry.body, fetchedAt: entry.fetchedAt } : null
  }

  set(key: string, source: string, entry: CachedResponse): void {
    this.entries.set(key, { ...entry, source })
  }
}
