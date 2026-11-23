import { CoreError, logError } from '@shared/errors'
import type { Db } from '../db/connection'
import type { AppleMusicApi } from './appleApi'

// Katalog id → ISRC (V8 bulgusu). MusicKit kütüphane öğelerinde (i.…) ISRC vermez; arka plan
// eşleştirmesi ISRC'yle hem daha hızlı hem daha doğrudur (V8 ölçümü: arama eşleşmesinde 1/13 belirsiz).
// Çözülen değer `apple_isrc` tablosunda kalıcıdır: yeniden açılışta cache'teki arka plan verisi ağ
// beklemeden okunur. Apple'da ISRC'si olmayan şarkı (`null`) bir süre sonra yeniden sorulur.
// Hata durumunda `undefined` döner: eşleştirme ISRC'siz (aramayla) sürer.

const DAY = 86_400_000
/** ISRC'si bulunamayan şarkı bu süreden sonra yeniden sorulur. */
export const MISSING_ISRC_RETRY_MS = 7 * DAY
/** Aynı anda gelen istekler bu kadar bekletilip tek Apple isteğinde toplanır. */
const BATCH_WINDOW_MS = 25

export type IsrcApi = Pick<AppleMusicApi, 'getSongIsrcs' | 'isSignedIn'>

export class IsrcResolver {
  private readonly pending = new Map<string, Promise<string | undefined>>()
  private batch: { ids: Set<string>; done: Promise<Map<string, string | null>> } | null = null
  /** `clear()` sonrası uçuştaki isteğin sonucu yazılmaz (2.7 Y2). */
  private generation = 0

  constructor(
    private readonly db: Db,
    private readonly api: IsrcApi,
    private readonly now: () => number = Date.now,
    private readonly batchWindowMs = BATCH_WINDOW_MS
  ) {}

  /** ISRC (büyük harf) veya bilinmiyorsa `undefined`. Hata fırlatmaz. */
  resolve(appleId: string): Promise<string | undefined> {
    const known = this.lookup(appleId)
    if (known !== undefined) return Promise.resolve(known ?? undefined)
    if (!this.api.isSignedIn()) return Promise.resolve(undefined)
    const existing = this.pending.get(appleId)
    if (existing) return existing
    const run = this.fetch(appleId).finally(() => this.pending.delete(appleId))
    this.pending.set(appleId, run)
    return run
  }

  /** Çıkış: dinleme geçmişini ele verebilir. */
  clear(): void {
    this.generation++
    this.pending.clear()
    this.db.prepare('DELETE FROM apple_isrc').run()
  }

  /** Kayıtlı değer: string (ISRC), `null` (Apple'da yok, henüz yeniden sorulmayacak), `undefined` (bilinmiyor). */
  private lookup(appleId: string): string | null | undefined {
    const row = this.db
      .prepare('SELECT isrc, fetched_at FROM apple_isrc WHERE apple_id = ?')
      .get(appleId) as { isrc: string | null; fetched_at: number } | undefined
    if (!row) return undefined
    if (row.isrc !== null) return row.isrc
    return this.now() - row.fetched_at < MISSING_ISRC_RETRY_MS ? null : undefined
  }

  private async fetch(appleId: string): Promise<string | undefined> {
    const generation = this.generation
    try {
      const found = await this.enqueue(appleId)
      const isrc = found.get(appleId)
      if (generation !== this.generation || !this.api.isSignedIn()) return isrc ?? undefined
      this.db
        .prepare(
          `INSERT INTO apple_isrc (apple_id, isrc, fetched_at) VALUES (?, ?, ?)
           ON CONFLICT(apple_id) DO UPDATE SET isrc = excluded.isrc, fetched_at = excluded.fetched_at`
        )
        .run(appleId, isrc ?? null, this.now())
      return isrc ?? undefined
    } catch (err) {
      // Ağ yok / yetki yok: eşleştirme aramayla sürer; sonraki istekte yeniden denenir.
      logError(
        'isrc',
        err instanceof CoreError ? err : new CoreError('API_REQUEST_FAILED', 'ISRC çözülemedi.')
      )
      return undefined
    }
  }

  /** Kısa pencerede gelen id'leri tek istekte toplar (ör. ön yükleme + çalan şarkı). */
  private enqueue(appleId: string): Promise<Map<string, string | null>> {
    if (!this.batch) {
      const ids = new Set<string>()
      const done = new Promise<Map<string, string | null>>((resolve, reject) => {
        setTimeout(() => {
          this.batch = null
          this.api.getSongIsrcs([...ids]).then(resolve, reject)
        }, this.batchWindowMs)
      })
      this.batch = { ids, done }
    }
    this.batch.ids.add(appleId)
    return this.batch.done
  }
}
