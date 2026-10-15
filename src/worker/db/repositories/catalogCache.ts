import type { Db } from '../connection'

// catalog_cache (R2, 2026-10-15): Ana Sayfa önerileri, Sık Çaldıkların, listeler, türler ve
// istasyonlar açılışta diskten anında gelsin diye saklanır (CatalogService `persisted`). Değer bizim
// ürettiğimiz JSON; okunamayan kayıt silinir ve yok sayılır. Kişisel veri içerir → çıkışta silinir.

export interface CatalogCacheEntry {
  value: unknown
  fetchedAt: number
}

export class CatalogCacheRepository {
  constructor(private readonly db: Db) {}

  get(key: string): CatalogCacheEntry | null {
    const row = this.db
      .prepare('SELECT value, fetched_at FROM catalog_cache WHERE key = ?')
      .get(key) as { value: string; fetched_at: number } | undefined
    if (!row) return null
    try {
      return { value: JSON.parse(row.value) as unknown, fetchedAt: row.fetched_at }
    } catch {
      this.db.prepare('DELETE FROM catalog_cache WHERE key = ?').run(key)
      return null
    }
  }

  put(key: string, value: unknown, fetchedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO catalog_cache (key, value, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`
      )
      .run(key, JSON.stringify(value), fetchedAt)
  }

  clear(): void {
    this.db.exec('DELETE FROM catalog_cache')
  }
}
