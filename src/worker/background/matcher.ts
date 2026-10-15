import { createHash } from 'node:crypto'
import { MatchSchema, type Match, type TrackRef } from '@shared/background'
import type { Db } from '../db/connection'
import { matchTrack, normalize } from './match'
import type { RequestOptions } from './sourceClient'
import { isCancelled } from './abort'
import type { CacheStoreOptions } from './cache'
import { entryBytes, TOUCH_GRANULARITY_MS, type WriteListener } from './cacheMaintenance'
import type { MusicBrainzSource } from './sources/musicbrainz'

// Eşleşme cache'i (PLAN 3.A2), tablo `bg_match` (migration 3). Kesin eşleşme 30 gün, belirsiz/yok
// sonucu 1 gün saklanır (MusicBrainz'e veri eklenince yeniden denensin). Çıkışta silinir.

const DAY = 86_400_000
const MATCH_TTL_MS = 30 * DAY
export const WEAK_MATCH_TTL_MS = DAY

/**
 * Şarkı bilgisinin kararlı anahtarı (sha256). Süre saniyeye yuvarlanır: aynı şarkının farklı
 * kaynaklardan gelen ms farkları aynı anahtarı verir.
 */
export function refKey(ref: TrackRef): string {
  const canonical = JSON.stringify([
    ref.isrc?.toUpperCase() ?? '',
    normalize(ref.title),
    normalize(ref.artist),
    normalize(ref.album ?? ''),
    ref.durationMs === undefined ? -1 : Math.round(ref.durationMs / 1000)
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export class MatchCache {
  private readonly now: () => number
  private readonly onWrite: WriteListener | undefined

  constructor(
    private readonly db: Db,
    { now, onWrite }: CacheStoreOptions = {}
  ) {
    this.now = now ?? Date.now
    this.onWrite = onWrite
  }

  get(key: string): { match: Match; matchedAt: number } | null {
    const row = this.db
      .prepare('SELECT result, matched_at, last_access FROM bg_match WHERE ref_key = ?')
      .get(key) as { result: string; matched_at: number; last_access: number } | undefined
    if (!row) return null
    const now = this.now()
    if (now - row.last_access >= TOUCH_GRANULARITY_MS) {
      this.db.prepare('UPDATE bg_match SET last_access = ? WHERE ref_key = ?').run(now, key)
    }
    try {
      const parsed = MatchSchema.safeParse(JSON.parse(row.result))
      return parsed.success ? { match: parsed.data, matchedAt: row.matched_at } : null
    } catch {
      return null
    }
  }

  set(key: string, match: Match, matchedAt: number): void {
    const result = JSON.stringify(match)
    this.db
      .prepare(
        `INSERT INTO bg_match (ref_key, result, matched_at, bytes, last_access)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref_key) DO UPDATE SET result = excluded.result, matched_at = excluded.matched_at,
           bytes = excluded.bytes, last_access = excluded.last_access`
      )
      .run(key, result, matchedAt, entryBytes(key, result), this.now())
    this.onWrite?.()
  }

  clear(): void {
    this.db.exec('DELETE FROM bg_match')
  }
}

export class Matcher {
  private readonly now: () => number

  constructor(
    private readonly mb: Pick<MusicBrainzSource, 'recordingsByIsrc' | 'searchRecordings'>,
    private readonly cache: MatchCache | null,
    now?: () => number
  ) {
    this.now = now ?? Date.now
  }

  /** Cache'te tazeyse ağa çıkmadan döner; aksi halde eşleştirir ve saklar. */
  async match(ref: TrackRef, opts: RequestOptions = {}): Promise<Match> {
    const key = refKey(ref)
    const cached = this.cache?.get(key)
    if (cached) {
      const ttl = cached.match.status === 'matched' ? MATCH_TTL_MS : WEAK_MATCH_TTL_MS
      if (this.now() - cached.matchedAt < ttl) return cached.match
    }
    try {
      const match = await matchTrack(ref, this.mb, opts)
      this.cache?.set(key, match, this.now())
      return match
    } catch (err) {
      // Kaynağa ulaşılamıyorsa eski eşleşme (varsa) kullanılmaya devam eder; iptal ise kullanılmaz.
      if (cached && !isCancelled(err)) return cached.match
      throw err
    }
  }
}
