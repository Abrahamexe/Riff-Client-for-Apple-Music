import type { Match, TrackRef } from '@shared/background'
import type { RequestOptions } from './sourceClient'
import {
  creditedName,
  type MusicBrainzSource,
  type RecordingCandidate,
  type ReleaseSummary
} from './sources/musicbrainz'

// Şarkı → MusicBrainz kaydı eşleştirme (PLAN 3.A2).
//  1. ISRC varsa `/isrc/<isrc>` adayları (ISRC tek başına kesin değildir: aynı ISRC birden çok kayda
//     bağlı olabilir; adaylar yine puanlanır).
//  2. ISRC yoksa veya güvenli eşleşme çıkmazsa başlık + sanatçı araması.
//  3. Her aday puanlanır: başlık ve sanatçı benzerliği, süre toleransı, albüm bonusu.
// Süresi 20 sn'den fazla farklı aday ELENİR: aynı adlı farklı şarkılar (cover, canlı, remix) yanlış
// eşleşmez. Güven 0.85 altında `uncertain`, 0.6 altında `none`: yanlış veri kesinmiş gibi gösterilmez.

const MATCHED_THRESHOLD = 0.85
const UNCERTAIN_THRESHOLD = 0.6
/** Bu kadar farklı süre aynı kayıt sayılmaz. */
const MAX_DURATION_DIFF_MS = 20_000

/** Karşılaştırma için normalleştirme: küçük harf, aksansız, noktalama ve fazla boşluk yok. */
export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Başlıktaki eşleşmeyi bozan ekler: "(feat. X)", "- Remastered 2011", "[Radio Edit]" vb. */
const NOISE =
  /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]|\s*[([][^)\]]*\b(?:remaster(?:ed)?|version|edit|mono|stereo|deluxe|bonus track)\b[^)\]]*[)\]]|\s+-\s+[^-]*\b(?:remaster(?:ed)?|version|edit|mono|stereo)\b.*$/gi

export function cleanTitle(title: string): string {
  return title.replace(NOISE, '').trim() || title
}

function bigrams(value: string): Map<string, number> {
  const s = value.replace(/\s+/g, '')
  const map = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2)
    map.set(bg, (map.get(bg) ?? 0) + 1)
  }
  return map
}

/** Sørensen–Dice benzerliği (0..1), normalleştirilmiş metinler üzerinde. */
export function similarity(a: string, b: string): number {
  const x = normalize(a)
  const y = normalize(b)
  if (x === y) return x === '' ? 0 : 1
  if (x.replace(/\s/g, '').length < 2 || y.replace(/\s/g, '').length < 2) return 0
  const bx = bigrams(x)
  const by = bigrams(y)
  let overlap = 0
  let total = 0
  for (const n of bx.values()) total += n
  for (const n of by.values()) total += n
  for (const [bg, n] of bx) overlap += Math.min(n, by.get(bg) ?? 0)
  return (2 * overlap) / total
}

function titleScore(a: string, b: string): number {
  return Math.max(similarity(a, b), similarity(cleanTitle(a), cleanTitle(b)) * 0.97)
}

/** "A, B & C feat. D" → ["A", "B", "C", "D"] */
function splitArtists(value: string): string[] {
  return value
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\band\b|\bx\b|\bvs\.?)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

function artistScore(ref: string, candidate: RecordingCandidate): number {
  const full = similarity(ref, creditedName(candidate.artistCredit))
  const first = candidate.artistCredit[0]
  const primary = first
    ? similarity(splitArtists(ref)[0] ?? ref, first.name ?? first.artist.name)
    : 0
  return Math.max(full, primary * 0.95)
}

/** Süre puanı: ±3 sn tam, 10 sn'de 0.5, 20 sn'de 0; daha fazlası elenir (`null`). */
export function durationScore(refMs: number, candidateMs: number): number | null {
  const diff = Math.abs(refMs - candidateMs)
  if (diff > MAX_DURATION_DIFF_MS) return null
  if (diff <= 3_000) return 1
  if (diff <= 10_000) return 1 - ((diff - 3_000) / 7_000) * 0.5
  return 0.5 - ((diff - 10_000) / 10_000) * 0.5
}

export interface ScoredCandidate {
  candidate: RecordingCandidate
  score: number
  viaIsrc: boolean
}

/** Adayı puanlar; elenirse `null`. */
function scoreCandidate(
  ref: TrackRef,
  candidate: RecordingCandidate,
  viaIsrc: boolean
): ScoredCandidate | null {
  const t = titleScore(ref.title, candidate.title)
  const a = artistScore(ref.artist, candidate)
  if (t < 0.5 || a < 0.4) return null

  let score: number
  if (ref.durationMs !== undefined && candidate.lengthMs !== null) {
    const d = durationScore(ref.durationMs, candidate.lengthMs)
    if (d === null) return null
    score = 0.45 * t + 0.35 * a + 0.2 * d
  } else {
    // Süre doğrulanamıyor: aynı başlıklı farklı kayıtlar ayırt edilemez, güven düşürülür.
    score = (0.55 * t + 0.45 * a) * 0.9
  }
  const album = ref.album ? cleanTitle(ref.album.replace(/\s+-\s+(single|ep)$/i, '')) : ''
  if (album && candidate.releases.some((r) => titleScore(album, r.title) >= 0.85)) score += 0.05
  if (viaIsrc) score += 0.1
  // Kırpılmaz: sıralamada bonuslar eşitliği bozar; güven (confidence) ayrıca 1'e kırpılır.
  return { candidate, score, viaIsrc }
}

/**
 * Kaydın yayınları arasından albüme en uygun olanı; yoksa resmi ve en eski tarihli. Aynı dönemde
 * tam tarihli yayın, yalnızca yıl bilinen yayından önce gelir ("1975-11-21" < "1975").
 */
export function pickRelease(
  releases: readonly ReleaseSummary[],
  album?: string
): ReleaseSummary | null {
  if (releases.length === 0) return null
  const rank = (r: ReleaseSummary): [number, number, string] => [
    album ? -titleScore(album, r.title) : 0,
    r.status === 'Official' ? 0 : 1,
    (r.date || '9999').padEnd(10, '~')
  ]
  return [...releases].sort((x, y) => {
    const a = rank(x)
    const b = rank(y)
    return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])
  })[0]!
}

function best(scored: (ScoredCandidate | null)[]): ScoredCandidate | null {
  let top: ScoredCandidate | null = null
  for (const s of scored) if (s && (!top || s.score > top.score)) top = s
  return top
}

const NO_MATCH: Match = {
  status: 'none',
  confidence: 0,
  method: null,
  recording: null,
  release: null
}

function toMatch(ref: TrackRef, top: ScoredCandidate | null): Match {
  if (!top || top.score < UNCERTAIN_THRESHOLD) return NO_MATCH
  const { candidate } = top
  const release = pickRelease(candidate.releases, ref.album)
  return {
    status: top.score >= MATCHED_THRESHOLD ? 'matched' : 'uncertain',
    confidence: Math.round(Math.min(1, top.score) * 100) / 100,
    method: top.viaIsrc ? 'isrc' : 'search',
    recording: {
      mbid: candidate.id,
      title: candidate.title,
      lengthMs: candidate.lengthMs,
      artistCredit: creditedName(candidate.artistCredit),
      artists: candidate.artistCredit.map((c) => ({ mbid: c.artist.id, name: c.artist.name }))
    },
    release: release ? { mbid: release.id, title: release.title, date: release.date ?? null } : null
  }
}

/** Şarkıyı MusicBrainz kaydıyla eşleştirir (en fazla 2 istek: ISRC + arama). */
export async function matchTrack(
  ref: TrackRef,
  mb: Pick<MusicBrainzSource, 'recordingsByIsrc' | 'searchRecordings'>,
  opts: RequestOptions = {}
): Promise<Match> {
  let top: ScoredCandidate | null = null
  if (ref.isrc) {
    const candidates = await mb.recordingsByIsrc(ref.isrc, opts)
    top = best(candidates.map((c) => scoreCandidate(ref, c, true)))
    if (top && top.score >= MATCHED_THRESHOLD) return toMatch(ref, top)
  }
  const found = await mb.searchRecordings(
    { title: cleanTitle(ref.title), artist: splitArtists(ref.artist)[0] ?? ref.artist },
    10,
    opts
  )
  const searched = best(found.map((c) => scoreCandidate(ref, c, false)))
  if (searched && (!top || searched.score > top.score)) top = searched
  return toMatch(ref, top)
}
