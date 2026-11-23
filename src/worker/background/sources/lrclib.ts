import { z } from 'zod/mini'
import type { TrackRef } from '@shared/background'
import { NO_LYRICS, type Lyrics } from '@shared/lyrics'
import { parseLrc, parsePlain } from '../lrc'
import { cleanTitle, normalize, similarity } from '../match'
import type { RequestOptions, SourceClient } from '../sourceClient'

// LRCLIB adaptörü (B11b) — https://lrclib.net/docs (2026-10-14'te okundu):
//  - `GET /api/get?track_name&artist_name[&album_name][&duration]`: en iyi eşleşme; yoksa 404.
//    Süre (sn, 1–3600) verilirse kayıt yalnızca ±2 sn içindeyse döner.
//  - `GET /api/search?track_name&artist_name`: en fazla 20 kayıt (sayfalama yok).
//  - Kayıt: id, trackName, artistName, albumName, duration (sn), instrumental, plainLyrics,
//    syncedLyrics (LRC). `lyricsfile` (YAML) kullanılmaz; şema onu atar, cache'e girmez.
//  - Tanımlayıcı User-Agent zorunlu; 429 + Retry-After'a uyulmalı; istekler sıralı, aralarında
//    200–500 ms (politika: policies.ts → lrclib).
// Akış: önce `/api/get` (albüm + süreyle); bulunamazsa `/api/search` ile adaylar puanlanır; o da boşsa
// başlıktaki "(feat. …)", "- Remastered" gibi ekler atılarak bir kez daha aranır. Senkron söz düz
// sözden, düz söz "enstrümantal"dan önce gelir.

const LRCLIB_ORIGIN = 'https://lrclib.net'

const Str = z.string().check(z.maxLength(1_000))
/** Söz metni sınırı (SourceClient gövdeyi zaten 2 MiB ile sınırlar). */
const LyricsText = z.nullable(z.string().check(z.maxLength(200_000)))
const opt = <T extends z.ZodMiniType>(schema: T) => z.catch(z.optional(schema), undefined)

const RecordSchema = z.object({
  id: z.number(),
  trackName: Str,
  artistName: Str,
  albumName: opt(z.nullable(Str)),
  duration: opt(z.nullable(z.number())),
  instrumental: opt(z.boolean()),
  plainLyrics: z.catch(LyricsText, null),
  syncedLyrics: z.catch(LyricsText, null)
})
type LrclibRecord = z.infer<typeof RecordSchema>
const SearchSchema = z.array(RecordSchema).check(z.maxLength(100))

/** Senkron sözlerde zaman kaymasını önlemek için kabul edilen en büyük süre farkı (LRCLIB: ±2 sn). */
const MAX_SYNCED_DIFF_S = 3
/** Düz sözlerde zaman önemsiz; yine de aynı başlıklı başka kaydı (canlı, uzun sürüm) elemek için. */
const MAX_PLAIN_DIFF_S = 20
const MIN_TITLE = 0.8
const MIN_ARTIST = 0.6

/** Kaydın içeriği: senkron > düz > enstrümantal > yok. */
export function recordLyrics(record: LrclibRecord | null): Lyrics {
  if (!record) return NO_LYRICS
  if (record.syncedLyrics) {
    const lines = parseLrc(record.syncedLyrics)
    if (lines.length > 0) return { kind: 'synced', lines }
  }
  if (record.plainLyrics) {
    const lines = parsePlain(record.plainLyrics)
    if (lines.length > 0) return { kind: 'plain', lines }
  }
  return record.instrumental ? { kind: 'instrumental', lines: [] } : NO_LYRICS
}

const rank = (lyrics: Lyrics): number =>
  ({ synced: 3, plain: 2, instrumental: 1, none: 0 })[lyrics.kind]

function artistMatches(ref: string, candidate: string): boolean {
  if (similarity(ref, candidate) >= MIN_ARTIST) return true
  // "A & B" ↔ "A": ilk sanatçı yeterli.
  const first = (s: string): string => normalize(s.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0]!)
  return first(ref) !== '' && first(ref) === first(candidate)
}

/** Arama sonuçlarından en uygun kaydın sözleri; uygun aday yoksa `none`. */
export function pickRecord(ref: TrackRef, records: readonly LrclibRecord[]): Lyrics {
  const refSec = ref.durationMs !== undefined ? ref.durationMs / 1000 : null
  let best: { lyrics: Lyrics; score: number } | null = null
  for (const record of records) {
    const title = Math.max(
      similarity(ref.title, record.trackName),
      similarity(cleanTitle(ref.title), cleanTitle(record.trackName))
    )
    if (title < MIN_TITLE || !artistMatches(ref.artist, record.artistName)) continue
    let lyrics = recordLyrics(record)
    if (lyrics.kind === 'none') continue
    const diff = refSec !== null && record.duration ? Math.abs(refSec - record.duration) : null
    if (diff !== null && diff > MAX_PLAIN_DIFF_S) continue
    // Süre tutmuyorsa senkron zamanlar kayar: yalnızca düz metin olarak kullanılır.
    if (lyrics.kind === 'synced' && diff !== null && diff > MAX_SYNCED_DIFF_S) {
      lyrics = { kind: 'plain', lines: lyrics.lines.map((l) => ({ ...l, timeMs: null })) }
    }
    const album =
      ref.album && record.albumName && similarity(ref.album, record.albumName) >= 0.85 ? 0.05 : 0
    const closeness =
      diff === null ? 0 : 0.1 * (1 - Math.min(diff, MAX_PLAIN_DIFF_S) / MAX_PLAIN_DIFF_S)
    const score = rank(lyrics) + title * 0.5 + album + closeness
    if (!best || score > best.score) best = { lyrics, score }
  }
  return best?.lyrics ?? NO_LYRICS
}

export class LrclibSource {
  constructor(private readonly client: SourceClient) {}

  /** Şarkının sözleri; hiçbir yolla bulunamazsa `none`. Ağ hatası `CoreError` olarak fırlar. */
  async find(ref: TrackRef, options: RequestOptions = {}): Promise<Lyrics> {
    const direct = recordLyrics(
      (await this.client.getJson(getUrl(ref), RecordSchema, options)).data
    )
    if (direct.kind === 'synced') return direct

    let found = pickRecord(ref, await this.search(ref.title, ref.artist, options))
    const cleaned = cleanTitle(ref.title)
    if (found.kind === 'none' && cleaned !== ref.title) {
      found = pickRecord(ref, await this.search(cleaned, ref.artist, options))
    }
    return rank(found) > rank(direct) ? found : direct
  }

  private async search(title: string, artist: string, options: RequestOptions) {
    const url = new URL('/api/search', LRCLIB_ORIGIN)
    url.searchParams.set('track_name', title)
    url.searchParams.set('artist_name', artist)
    return (await this.client.getJson(url, SearchSchema, options)).data ?? []
  }
}

function getUrl(ref: TrackRef): URL {
  const url = new URL('/api/get', LRCLIB_ORIGIN)
  url.searchParams.set('track_name', ref.title)
  url.searchParams.set('artist_name', ref.artist)
  if (ref.album) url.searchParams.set('album_name', ref.album)
  const seconds = ref.durationMs !== undefined ? Math.round(ref.durationMs / 1000) : 0
  if (seconds >= 1 && seconds <= 3600) url.searchParams.set('duration', String(seconds))
  return url
}
