import { z } from 'zod/mini'
import type { RequestOptions, SourceClient, SourceResult } from '../sourceClient'

// MusicBrainz Web Service v2 (https://musicbrainz.org/doc/MusicBrainz_API). JSON için `fmt=json`.
// Hız sınırı ve User-Agent: policies.ts. Şemalar hoşgörülüdür: beklenmeyen alan atılır, hatalı tipte
// alan yok sayılır; kimliği (MBID) olmayan öğe atlanır (Güvenlik kuralı 6).

const MB_ROOT = 'https://musicbrainz.org/ws/2/'

/** Alan yoksa veya tipi hatalıysa `undefined`. */
const opt = <T extends z.ZodMiniType>(schema: T) => z.catch(z.optional(schema), undefined)
/** Dizi yoksa/hatalıysa boş; geçersiz öğeler `filterValid` ile atılır. */
const list = z.catch(z.array(z.unknown()), [])

const MbidSchema = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/))

const Str = z.string().check(z.maxLength(2_000))

const ArtistRefSchema = z.object({ id: MbidSchema, name: Str })

const ArtistCreditSchema = z.object({
  name: opt(Str),
  joinphrase: opt(Str),
  artist: ArtistRefSchema
})
export type ArtistCredit = z.infer<typeof ArtistCreditSchema>

export const ReleaseSummarySchema = z.object({
  id: MbidSchema,
  title: Str,
  status: opt(Str),
  date: opt(Str),
  country: opt(Str)
})
export type ReleaseSummary = z.infer<typeof ReleaseSummarySchema>

/** İlişki (relationship): hedefi `target-type`'a göre `artist`/`place`/`work`/`label` alanındadır. */
export interface Relation {
  type: string
  targetType: string
  direction?: string
  attributes: string[]
  begin?: string
  end?: string
  artist?: { id: string; name: string }
  place?: { id: string; name: string; area?: string }
  label?: { id: string; name: string }
  work?: { id: string; title: string; relations: Relation[] }
  /** Kayıt → kayıt ilişkisi (ör. "samples material"); sanatçı adı kredideki gibi birleştirilmiş. */
  recording?: { id: string; title: string; artist: string }
}

const RelationBaseSchema = z.object({
  type: Str,
  'target-type': Str,
  direction: opt(Str),
  attributes: z.catch(z.array(z.string()), []),
  begin: opt(z.nullable(Str)),
  end: opt(z.nullable(Str)),
  artist: opt(ArtistRefSchema),
  place: opt(z.object({ id: MbidSchema, name: Str, area: opt(z.object({ name: Str })) })),
  label: opt(z.object({ id: MbidSchema, name: Str })),
  work: opt(z.object({ id: MbidSchema, title: Str, relations: list })),
  recording: opt(
    z.object({
      id: MbidSchema,
      title: Str,
      'artist-credit': z.catch(z.array(z.object({ name: opt(Str), joinphrase: opt(Str) })), [])
    })
  )
})

/** İlişki listesini doğrular; geçersizleri atar. İç içe (eser) ilişkileri bir seviye iner. */
export function parseRelations(items: readonly unknown[], depth = 1): Relation[] {
  const out: Relation[] = []
  for (const item of items) {
    const parsed = RelationBaseSchema.safeParse(item)
    if (!parsed.success) continue
    const r = parsed.data
    out.push({
      type: r.type,
      targetType: r['target-type'],
      ...(r.direction ? { direction: r.direction } : {}),
      attributes: r.attributes,
      ...(r.begin ? { begin: r.begin } : {}),
      ...(r.end ? { end: r.end } : {}),
      ...(r.artist ? { artist: r.artist } : {}),
      ...(r.place
        ? {
            place: {
              id: r.place.id,
              name: r.place.name,
              ...(r.place.area ? { area: r.place.area.name } : {})
            }
          }
        : {}),
      ...(r.label ? { label: r.label } : {}),
      ...(r.recording
        ? {
            recording: {
              id: r.recording.id,
              title: r.recording.title,
              artist: r.recording['artist-credit']
                .map((c) => `${c.name ?? ''}${c.joinphrase ?? ''}`)
                .join('')
                .trim()
            }
          }
        : {}),
      ...(r.work
        ? {
            work: {
              id: r.work.id,
              title: r.work.title,
              relations: depth > 0 ? parseRelations(r.work.relations, depth - 1) : []
            }
          }
        : {})
    })
  }
  return out
}

/** Geçersiz öğeleri atarak diziyi doğrular. */
function filterValid<T>(schema: z.ZodMiniType<T>, items: readonly unknown[]): T[] {
  const out: T[] = []
  for (const item of items) {
    const parsed = schema.safeParse(item)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

const RecordingCandidateSchema = z.object({
  id: MbidSchema,
  title: Str,
  length: opt(z.nullable(z.number().check(z.gte(0)))),
  score: opt(z.number()),
  'artist-credit': list,
  releases: list
})

export interface RecordingCandidate {
  id: string
  title: string
  lengthMs: number | null
  artistCredit: ArtistCredit[]
  releases: ReleaseSummary[]
}

const toCandidate = (r: z.infer<typeof RecordingCandidateSchema>): RecordingCandidate => ({
  id: r.id,
  title: r.title,
  lengthMs: r.length ?? null,
  artistCredit: filterValid(ArtistCreditSchema, r['artist-credit']),
  releases: filterValid(ReleaseSummarySchema, r.releases)
})

const CandidateListSchema = z.object({ recordings: list })

const RecordingDetailSchema = z.object({
  id: MbidSchema,
  title: Str,
  length: opt(z.nullable(z.number())),
  'first-release-date': opt(Str),
  disambiguation: opt(Str),
  'artist-credit': list,
  isrcs: z.catch(z.array(z.string()), []),
  releases: list,
  relations: list
})

export interface RecordingDetail {
  id: string
  title: string
  lengthMs: number | null
  firstReleaseDate: string | null
  artistCredit: ArtistCredit[]
  isrcs: string[]
  releases: ReleaseSummary[]
  relations: Relation[]
}

const ReleaseDetailSchema = z.object({
  id: MbidSchema,
  title: Str,
  date: opt(Str),
  country: opt(Str),
  status: opt(Str),
  'label-info': list,
  relations: list
})

const LabelInfoSchema = z.object({
  'catalog-number': opt(z.nullable(Str)),
  label: z.object({ id: MbidSchema, name: Str })
})

export interface ReleaseDetail {
  id: string
  title: string
  date: string | null
  country: string | null
  labels: { mbid: string; name: string; catalogNumber: string | null }[]
  relations: Relation[]
}

/** Lucene özel karakterlerini kaçırır (MusicBrainz arama sözdizimi). */
export function escapeLucene(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, (c) => `\\${c}`)
}

/** Kayıt sorgusunun ilişki ve alt sorgu kapsamı (dokümandaki `inc` değerleri). */
export const RECORDING_INC = [
  'artist-credits',
  'isrcs',
  'releases',
  'artist-rels',
  'place-rels',
  'work-rels',
  // work-rels ile birlikte: eserin kendi ilişkileri (besteci, söz yazarı) aynı yanıtta gelir.
  'work-level-rels',
  // Sample'lar (2026-10-14, geliştirici isteği): kayıt → kayıt "samples material" ilişkisi; hedef
  // kaydın sanatçısı `artist-credits` ile gelir (gerçek yanıtla doğrulandı: Stronger → Daft Punk).
  'recording-rels'
].join('+')

export const RELEASE_INC = ['labels', 'artist-rels', 'place-rels'].join('+')

export class MusicBrainzSource {
  constructor(private readonly client: SourceClient) {}

  private url(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(path, MB_ROOT)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    url.searchParams.set('fmt', 'json')
    return url
  }

  /** ISRC → kayıtlar (`/isrc/<isrc>`). Bulunamazsa boş liste. */
  async recordingsByIsrc(isrc: string, opts?: RequestOptions): Promise<RecordingCandidate[]> {
    const res = await this.client.getJson(
      this.url(`isrc/${encodeURIComponent(isrc.toUpperCase())}`, {
        inc: 'artist-credits+releases'
      }),
      CandidateListSchema,
      opts
    )
    return filterValid(RecordingCandidateSchema, res.data?.recordings ?? []).map(toCandidate)
  }

  /** Başlık + sanatçı ile kayıt araması (Lucene; en fazla `limit` aday). */
  async searchRecordings(
    { title, artist }: { title: string; artist: string },
    limit = 10,
    opts?: RequestOptions
  ): Promise<RecordingCandidate[]> {
    const query = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`
    const res = await this.client.getJson(
      this.url('recording', { query, limit: String(limit) }),
      CandidateListSchema,
      opts
    )
    return filterValid(RecordingCandidateSchema, res.data?.recordings ?? []).map(toCandidate)
  }

  /** Kayıt + krediler + eser + yer ilişkileri (tek istek). Bulunamazsa `null`. */
  async recording(mbid: string, opts?: RequestOptions): Promise<SourceResult<RecordingDetail>> {
    const res = await this.client.getJson(
      this.url(`recording/${mbid}`, { inc: RECORDING_INC }),
      RecordingDetailSchema,
      opts
    )
    const r = res.data
    return {
      ...res,
      data: r && {
        id: r.id,
        title: r.title,
        lengthMs: r.length ?? null,
        firstReleaseDate: r['first-release-date'] || null,
        artistCredit: filterValid(ArtistCreditSchema, r['artist-credit']),
        isrcs: r.isrcs,
        releases: filterValid(ReleaseSummarySchema, r.releases),
        relations: parseRelations(r.relations)
      }
    }
  }

  /** Yayın + label + yayın düzeyi krediler (tek istek). Bulunamazsa `null`. */
  async release(mbid: string, opts?: RequestOptions): Promise<SourceResult<ReleaseDetail>> {
    const res = await this.client.getJson(
      this.url(`release/${mbid}`, { inc: RELEASE_INC }),
      ReleaseDetailSchema,
      opts
    )
    const r = res.data
    return {
      ...res,
      data: r && {
        id: r.id,
        title: r.title,
        date: r.date || null,
        country: r.country || null,
        labels: filterValid(LabelInfoSchema, r['label-info']).map((li) => ({
          mbid: li.label.id,
          name: li.label.name,
          catalogNumber: li['catalog-number'] ?? null
        })),
        relations: parseRelations(r.relations)
      }
    }
  }
}

/** Kredideki görünen ad: "A feat. B" (joinphrase'lerle). */
export function creditedName(credit: readonly ArtistCredit[]): string {
  return credit
    .map((c) => `${c.name ?? c.artist.name}${c.joinphrase ?? ''}`)
    .join('')
    .trim()
}
