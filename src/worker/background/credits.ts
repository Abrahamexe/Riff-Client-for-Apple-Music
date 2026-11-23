import {
  MAX_SAMPLES,
  type Credit,
  type CreditRole,
  type Label,
  type Match,
  type SampleRef,
  type Studio,
  type Work
} from '@shared/background'
import { pickRelease } from './match'
import type { RequestOptions } from './sourceClient'
import type { MusicBrainzSource, Relation } from './sources/musicbrainz'
import { isCancelled } from './abort'
import { toPlainText } from './text'

// MusicBrainz arka plan verisi (PLAN 3.A3). Eşleşen kayıttan en fazla İKİ istekle:
//  1. `recording/<mbid>?inc=artist-credits+isrcs+releases+artist-rels+place-rels+work-rels+work-level-rels`
//     → kayıt kredileri (prodüktör, mühendis, icracılar), stüdyo, eser ve eserin besteci/söz yazarı;
//  2. `release/<mbid>?inc=labels+artist-rels+place-rels` → label, çıkış tarihi, yayın düzeyi krediler.
// `inc` değerleri dokümandan doğrulandı (https://musicbrainz.org/doc/MusicBrainz_API): work-level-rels
// yalnızca bir anahtardır; eserin sanatçı ilişkileri için work-rels + artist-rels de istenmelidir.

/** MusicBrainz ilişki adı → ortak rol. Listede olmayanlar `other` (ham ad korunur). */
const ROLE_BY_TYPE: Readonly<Record<string, CreditRole>> = {
  composer: 'composer',
  lyricist: 'lyricist',
  librettist: 'lyricist',
  writer: 'writer',
  arranger: 'arranger',
  'instrument arranger': 'arranger',
  'vocal arranger': 'arranger',
  orchestrator: 'arranger',
  producer: 'producer',
  engineer: 'engineer',
  audio: 'engineer',
  sound: 'engineer',
  balance: 'engineer',
  recording: 'recording',
  'field recordist': 'recording',
  mix: 'mix',
  mastering: 'mastering',
  remixer: 'remixer',
  programming: 'programming',
  performer: 'performer',
  'performing orchestra': 'performer',
  conductor: 'performer',
  'chorus master': 'performer',
  concertmaster: 'performer',
  vocal: 'vocal',
  instrument: 'instrument',
  design: 'design',
  'graphic design': 'design',
  'design/illustration': 'design',
  artwork: 'design',
  illustration: 'design',
  photography: 'design',
  'art direction': 'design'
}

export function roleOf(type: string): CreditRole {
  return ROLE_BY_TYPE[type.toLowerCase()] ?? 'other'
}

const plain = (s: string, max = 500): string => toPlainText(s, max)

export interface MusicBrainzBackground {
  recording: {
    mbid: string
    title: string
    firstReleaseDate: string | null
    isrcs: string[]
    url: string
  }
  credits: Credit[]
  studios: Studio[]
  works: Work[]
  samples: { samples: SampleRef[]; sampledBy: SampleRef[] }
  release: {
    mbid: string
    title: string
    date: string | null
    country: string | null
    labels: Label[]
    url: string
  } | null
  /** Kayıt ilişkileri ve yayın sorgularından alınma zamanı (en eskisi). */
  fetchedAt: number
}

function artistCredits(relations: readonly Relation[], scope: Credit['scope']): Credit[] {
  const out: Credit[] = []
  for (const r of relations) {
    if (r.targetType !== 'artist' || !r.artist) continue
    out.push({
      role: roleOf(r.type),
      rawRole: plain(r.type, 200),
      name: plain(r.artist.name),
      mbid: r.artist.id,
      attributes: r.attributes.map((a) => plain(a, 200)),
      scope,
      source: 'musicbrainz'
    })
  }
  return out
}

function studios(relations: readonly Relation[]): Studio[] {
  return relations
    .filter((r) => r.targetType === 'place' && r.place)
    .map((r) => ({
      name: plain(r.place!.name),
      mbid: r.place!.id,
      area: r.place!.area ? plain(r.place!.area) : null,
      rawRole: plain(r.type, 200),
      begin: r.begin ?? null,
      end: r.end ?? null,
      source: 'musicbrainz' as const
    }))
}

/**
 * "samples material" ilişkileri: ileri yön = bu kaydın kullandığı, geri yön = bu kaydı kullanan.
 * Aynı kayıt bir kez; her yönde en fazla `MAX_SAMPLES`.
 */
export function sampleRefs(relations: readonly Relation[]): MusicBrainzBackground['samples'] {
  const out: MusicBrainzBackground['samples'] = { samples: [], sampledBy: [] }
  const seen = new Set<string>()
  for (const r of relations) {
    if (r.type !== 'samples material' || r.targetType !== 'recording' || !r.recording) continue
    const list = r.direction === 'backward' ? out.sampledBy : out.samples
    const key = `${r.direction ?? 'forward'}|${r.recording.id}`
    if (seen.has(key) || list.length >= MAX_SAMPLES) continue
    seen.add(key)
    list.push({
      title: plain(r.recording.title, 1_000),
      artist: plain(r.recording.artist, 1_000),
      mbid: r.recording.id,
      source: 'musicbrainz'
    })
  }
  return out
}

/** Sample'ı olmayan kayıtta bakılacak sürüm ilişkileri (ör. "clean" düzenleme ↔ orijinal). */
const VERSION_RELATIONS = new Set(['edit', 'remaster'])

/**
 * Kaydın sample'ları; yoksa "edit" / "remaster" ile bağlı İLK kaydınkiler (tek ek istek). Gözlem
 * (2026-10-14): Apple'ın "Stronger" ISRC'si MusicBrainz'de "clean" düzenlemeye eşleşiyor; sample
 * ilişkisi orijinal kayıtta.
 */
export async function samplesWithVersions(
  relations: readonly Relation[],
  mb: Pick<MusicBrainzSource, 'recording'>,
  opts: RequestOptions
): Promise<MusicBrainzBackground['samples']> {
  const own = sampleRefs(relations)
  if (own.samples.length > 0 || own.sampledBy.length > 0) return own
  const version = relations.find(
    (r) => VERSION_RELATIONS.has(r.type) && r.targetType === 'recording' && r.recording
  )
  if (!version?.recording) return own
  try {
    const other = await mb.recording(version.recording.id, opts)
    return other.data ? sampleRefs(other.data.relations) : own
  } catch (err) {
    // İptal yukarı iletilir; diğer hatalar sample'sız sonuç (ana bilgiyi bozmasın).
    if (isCancelled(err)) throw err
    return own
  }
}

/** Aynı kişi + aynı rol + aynı düzey bir kez (ör. eserde hem composer hem lyricist ayrı kalır). */
function dedupeCredits(credits: readonly Credit[]): Credit[] {
  const seen = new Map<string, Credit>()
  for (const c of credits) {
    const key = `${c.scope}|${c.rawRole}|${c.mbid ?? c.name.toLowerCase()}`
    const prev = seen.get(key)
    if (!prev) seen.set(key, { ...c, attributes: [...c.attributes] })
    else for (const a of c.attributes) if (!prev.attributes.includes(a)) prev.attributes.push(a)
  }
  return [...seen.values()]
}

/**
 * Eşleşmeden MusicBrainz arka planını çıkarır. Eşleşme yoksa `null` (istek atılmaz). Eşleşmede
 * yayın yoksa (ör. ISRC aramasının yanıtı yayın listesi içermediğinde) yayın, kayıt ayrıntısındaki
 * yayınlar arasından albüme göre seçilir (duman testi bulgusu).
 */
export async function fetchMusicBrainzBackground(
  match: Match,
  mb: Pick<MusicBrainzSource, 'recording' | 'release'>,
  opts: RequestOptions = {},
  album?: string
): Promise<MusicBrainzBackground | null> {
  if (!match.recording) return null
  const rec = await mb.recording(match.recording.mbid, opts)
  if (!rec.data) return null
  const r = rec.data

  const works: Work[] = []
  const credits: Credit[] = artistCredits(r.relations, 'recording')
  for (const rel of r.relations) {
    if (rel.targetType !== 'work' || !rel.work) continue
    works.push({ title: plain(rel.work.title, 1_000), mbid: rel.work.id, source: 'musicbrainz' })
    credits.push(...artistCredits(rel.work.relations, 'work'))
  }

  let release: MusicBrainzBackground['release'] = null
  let fetchedAt = rec.fetchedAt
  const releaseMbid = match.release?.mbid ?? pickRelease(r.releases, album)?.id ?? null
  if (releaseMbid) {
    const rel = await mb.release(releaseMbid, opts)
    if (rel.data) {
      fetchedAt = Math.min(fetchedAt, rel.fetchedAt)
      credits.push(...artistCredits(rel.data.relations, 'release'))
      release = {
        mbid: rel.data.id,
        title: plain(rel.data.title, 1_000),
        date: rel.data.date,
        country: rel.data.country,
        labels: rel.data.labels.map((l) => ({
          name: plain(l.name),
          mbid: l.mbid,
          catalogNumber: l.catalogNumber ? plain(l.catalogNumber, 200) : null,
          source: 'musicbrainz' as const
        })),
        url: `https://musicbrainz.org/release/${rel.data.id}`
      }
    }
  }

  return {
    recording: {
      mbid: r.id,
      title: plain(r.title, 1_000),
      firstReleaseDate: r.firstReleaseDate,
      isrcs: r.isrcs.filter((i) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(i)).slice(0, 20),
      url: `https://musicbrainz.org/recording/${r.id}`
    },
    credits: dedupeCredits(credits),
    studios: studios(r.relations),
    works,
    samples: await samplesWithVersions(r.relations, mb, opts),
    release,
    fetchedAt
  }
}
