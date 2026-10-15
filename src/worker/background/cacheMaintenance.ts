import { logError } from '@shared/errors'
import { reclaimSpace, transaction, type Db } from '../db/connection'
import { BACKGROUND_SOURCE_IDS, SOURCE_POLICIES } from './sources/policies'

// Arka plan cache'i boyut yönetimi (PLAN 3.A8). Üç tablo (`bg_http_cache`, `bg_match`, `bg_track`)
// tek bütçeyi paylaşır:
//  1. Süresi dolanlar silinir (kaynak başına `retainMs`; eşleşme ve birleşik sonuç için aşağıdaki sabitler).
//  2. Toplam boyut `maxBytes`'ı aşıyorsa, tablolar arası en uzun süredir erişilmeyen satırlar (LRU)
//     `maxBytes * lowWaterRatio` altına inene kadar silinir.
//  3. Bir şey silindiyse boşalan sayfalar dosyadan çıkarılır (`reclaimSpace`): DB `incremental`
//     auto_vacuum modunda olduğu için dosya gerçekten küçülür (connection.ts).
// Temizlik periyodik zamanlayıcıyla DEĞİL, açılışta (`sweep()`) ve `sweepEveryWrites` cache yazımından
// sonra (`noteWrite()`) çalışır: worker boşta iş yapmaz (PLAN 1.8b). Boyut, her satırın `bytes`
// sütunundan (anahtar + saklanan JSON) okunur; gövdeler taranmaz.

const DAY = 86_400_000
/** Eşleşme: kesin sonuç 30 gün tazedir (matcher.ts); eski eşleşme çevrimdışı yedek olarak 90 güne kadar kalır. */
export const MATCH_RETAIN_MS = 90 * DAY
/** Birleşik sonuç: 3 gün tazedir (service.ts); eskisi çevrimdışı gösterim için 30 güne kadar kalır. */
export const TRACK_RETAIN_MS = 30 * DAY

const EVICTION_BATCH = 200
/** Okuma, son erişimi en fazla bu sıklıkta günceller (her cache isabetinde yazım yapılmaz). */
export const TOUCH_GRANULARITY_MS = 60_000

/** Satırın cache bütçesindeki boyutu: anahtar + saklanan metin (UTF-8 bayt). */
export function entryBytes(key: string, payload: string): number {
  return Buffer.byteLength(key) + Buffer.byteLength(payload)
}

/** Cache tablolarının ortak "yazıldı" bildirimi (CacheMaintenance.noteWrite). */
export type WriteListener = () => void

export interface CacheMaintenanceOptions {
  maxBytes: number
  lowWaterRatio: number
  sweepEveryWrites: number
  now?: () => number
}

export interface SweepResult {
  expired: number
  evicted: number
  bytesBefore: number
  bytesAfter: number
}

export class CacheMaintenance {
  private readonly now: () => number
  private writes = 0
  private sweeping = false

  constructor(
    private readonly db: Db,
    private readonly options: CacheMaintenanceOptions
  ) {
    if (!(options.maxBytes > 0) || !(options.lowWaterRatio > 0 && options.lowWaterRatio <= 1)) {
      throw new RangeError('Geçersiz cache boyut ayarı.')
    }
    this.now = options.now ?? Date.now
  }

  /** Bir cache satırı yazıldı; yeterince yazım biriktiyse temizlik çalışır. Hata yazımı bozmaz. */
  noteWrite(): void {
    if (++this.writes < this.options.sweepEveryWrites) return
    try {
      this.sweep()
    } catch (err) {
      logError('background', err, 'INTERNAL', 'Arka plan cache temizliği başarısız.')
    }
  }

  /** Saklanan toplam veri boyutu (bayt). */
  totalBytes(): number {
    const row = this.db
      .prepare(
        `SELECT (SELECT COALESCE(SUM(bytes), 0) FROM bg_http_cache)
              + (SELECT COALESCE(SUM(bytes), 0) FROM bg_match)
              + (SELECT COALESCE(SUM(bytes), 0) FROM bg_track) AS total`
      )
      .get() as { total: number }
    return row.total
  }

  /** Süresi dolanları ve sınırı aşan fazlayı siler; boşalan alanı dosyadan çıkarır. */
  sweep(): SweepResult {
    if (this.sweeping) return { expired: 0, evicted: 0, bytesBefore: 0, bytesAfter: 0 }
    this.sweeping = true
    try {
      this.writes = 0
      const bytesBefore = this.totalBytes()
      const expired = this.deleteExpired()
      const evicted = this.evictLeastRecentlyUsed()
      if (expired + evicted > 0) reclaimSpace(this.db)
      return { expired, evicted, bytesBefore, bytesAfter: this.totalBytes() }
    } finally {
      this.sweeping = false
    }
  }

  /** Tüm cache silindikten sonra (çıkış) boşalan alanı dosyadan çıkarır. */
  reclaim(): void {
    reclaimSpace(this.db)
  }

  private deleteExpired(): number {
    const now = this.now()
    let removed = 0
    transaction(this.db, () => {
      const run = (sql: string, ...params: (string | number)[]): void => {
        removed += Number(this.db.prepare(sql).run(...params).changes)
      }
      for (const id of BACKGROUND_SOURCE_IDS) {
        run(
          'DELETE FROM bg_http_cache WHERE source = ? AND fetched_at < ?',
          id,
          now - SOURCE_POLICIES[id].retainMs
        )
      }
      run('DELETE FROM bg_match WHERE matched_at < ?', now - MATCH_RETAIN_MS)
      run('DELETE FROM bg_track WHERE fetched_at < ?', now - TRACK_RETAIN_MS)
    })
    return removed
  }

  /**
   * Toplam boyut `maxBytes`'ı aşıyorsa `lowWaterRatio` altına inene kadar en eski erişilenleri siler.
   * Erişim zamanı eşitse önce ara veri (HTTP yanıtı), sonra eşleşme, en son birleşik sonuç silinir:
   * son ürün (`bg_track`) kendi ham girdilerinden daha değerlidir.
   */
  private evictLeastRecentlyUsed(): number {
    let total = this.totalBytes()
    if (total <= this.options.maxBytes) return 0
    const target = Math.floor(this.options.maxBytes * this.options.lowWaterRatio)
    const oldest = this.db.prepare(
      `SELECT t, k, k2, bytes FROM (
         SELECT 'h' AS t, key AS k, '' AS k2, bytes, last_access FROM bg_http_cache
         UNION ALL SELECT 'm', ref_key, '', bytes, last_access FROM bg_match
         UNION ALL SELECT 't', ref_key, lang, bytes, last_access FROM bg_track
       ) ORDER BY last_access ASC, CASE t WHEN 'h' THEN 0 WHEN 'm' THEN 1 ELSE 2 END ASC
       LIMIT ${EVICTION_BATCH}`
    )
    const del = {
      h: this.db.prepare('DELETE FROM bg_http_cache WHERE key = ?'),
      m: this.db.prepare('DELETE FROM bg_match WHERE ref_key = ?'),
      t: this.db.prepare('DELETE FROM bg_track WHERE ref_key = ? AND lang = ?')
    }
    let evicted = 0
    while (total > target) {
      const batch = oldest.all() as { t: 'h' | 'm' | 't'; k: string; k2: string; bytes: number }[]
      if (batch.length === 0) break
      transaction(this.db, () => {
        for (const row of batch) {
          if (total <= target) break
          if (row.t === 't') del.t.run(row.k, row.k2)
          else del[row.t].run(row.k)
          total -= row.bytes
          evicted++
        }
      })
    }
    return evicted
  }
}
