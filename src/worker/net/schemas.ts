import { z } from 'zod/mini'
import type { Album, Artist, Card, Playlist, Track } from '@shared/ipc-contract'

// Apple Music API yanıt şemaları (PLAN 1.7, Güvenlik kuralı 6). Apple verisi de güvenilmezdir:
//  - beklenmeyen alanlar atılır, hatalı tipte alan `undefined` sayılır (çökme sebebi olmaz);
//  - kimliği olmayan kaynak tamamen atlanır;
//  - kapak URL'si yalnızca https ise kullanılır (ileride <img src> olarak render edilecek).

/** Alan yoksa veya tipi hatalıysa `undefined`. */
const opt = <T extends z.ZodMiniType>(schema: T) => z.catch(z.optional(schema), undefined)

/** ISRC: ülke (2) + kayıt sahibi (3) + yıl (2) + numara (5). */
const ISRC_PATTERN = /^[A-Za-z]{2}[A-Za-z0-9]{3}[0-9]{7}$/

const PlayParamsSchema = z.object({
  id: z.string(),
  kind: z.string(),
  catalogId: opt(z.string())
})

/** İlişki / görünüm: `data` dizi değilse boş sayılır; öğeler ayrı ayrı doğrulanır. */
const RelationSchema = z.object({
  data: z.catch(z.array(z.unknown()), []),
  next: opt(z.string()),
  attributes: opt(z.object({ title: opt(z.string()) }))
})

export const ResourceSchema = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(256)),
  type: opt(z.string()),
  relationships: opt(z.record(z.string(), RelationSchema)),
  views: opt(z.record(z.string(), RelationSchema)),
  attributes: opt(
    z.object({
      name: opt(z.string()),
      artistName: opt(z.string()),
      albumName: opt(z.string()),
      durationInMillis: opt(z.number().check(z.gte(0))),
      playParams: opt(PlayParamsSchema),
      artwork: opt(z.object({ url: opt(z.string()) })),
      description: opt(z.object({ standard: opt(z.string()), short: opt(z.string()) })),
      canEdit: opt(z.boolean()),
      /** Albümlerde (3.B1). */
      trackCount: opt(z.number().check(z.int(), z.gte(0))),
      /** `explicit` / `clean` (arayüzde "E"). */
      contentRating: opt(z.string()),
      trackNumber: opt(z.number().check(z.int(), z.gte(0))),
      discNumber: opt(z.number().check(z.int(), z.gte(0))),
      releaseDate: opt(z.string().check(z.maxLength(32))),
      genreNames: opt(z.array(z.string())),
      copyright: opt(z.string()),
      recordLabel: opt(z.string()),
      curatorName: opt(z.string()),
      stationProviderName: opt(z.string()),
      isLive: opt(z.boolean()),
      editorialNotes: opt(
        z.object({ standard: opt(z.string()), short: opt(z.string()), tagline: opt(z.string()) })
      ),
      /** B5: albüm ses türleri (`extend=audioVariants`). */
      audioVariants: opt(z.array(z.string().check(z.maxLength(40)))),
      /** Öneri grubu başlığı (PersonalRecommendation). */
      title: opt(z.object({ stringForDisplay: opt(z.string()) })),
      /** Katalog şarkılarında (V8: arka plan eşleştirmesi). */
      isrc: opt(z.string().check(z.regex(ISRC_PATTERN))),
      /** §3.6: katalog şarkısı (kütüphanede `include=catalog` ile). */
      composerName: opt(z.string().check(z.maxLength(2_000))),
      /** §3.6: katalog albümü (kütüphanede `include=catalog` ile). */
      isCompilation: opt(z.boolean())
    })
  )
})
export type Resource = z.infer<typeof ResourceSchema>

/** Sayfa: `data` dizi değilse boş sayılır; öğeler ayrı ayrı doğrulanır. */
export const PageSchema = z.object({
  data: z.catch(z.array(z.unknown()), []),
  next: opt(z.string()),
  /** Toplam öğe sayısı (kütüphane uç noktaları verir): kalan sayfalar paralel çekilir (2.2). */
  meta: opt(z.object({ total: opt(z.number().check(z.int(), z.gte(0))) }))
})

export const SearchBodySchema = z.object({
  results: z.catch(z.record(z.string(), z.unknown()), {})
})

/**
 * GET /v1/catalog/{sf}/search/suggestions (P2 gözlemi 2026-10-13): `results.suggestions[]` öğeleri
 * `{ kind: 'terms', searchTerm, displayTerm, source }` veya `{ kind: 'topResults', content: kaynak }`.
 * Öğe öğe doğrulanır (biri bozuksa yalnızca o atlanır).
 */
export const SuggestionsBodySchema = z.object({
  results: z.catch(z.object({ suggestions: z.catch(z.array(z.unknown()), []) }), {
    suggestions: []
  })
})
export const TermSuggestionSchema = z.object({
  kind: z.literal('terms'),
  searchTerm: z.string().check(z.maxLength(200)),
  displayTerm: z.string().check(z.maxLength(200))
})
export const TopSuggestionSchema = z.object({
  kind: z.literal('topResults'),
  content: z.unknown()
})

/** GET /v1/catalog/{sf}/charts: tür → liste grupları. */
export const ChartsBodySchema = z.object({
  results: z.catch(
    z.record(
      z.string(),
      z.catch(
        z.array(
          z.object({
            chart: opt(z.string().check(z.maxLength(64))),
            name: opt(z.string()),
            data: z.catch(z.array(z.unknown()), [])
          })
        ),
        []
      )
    ),
    {}
  )
})

/** GET /v1/me/ratings/{tür}: yalnızca 1 / -1 geçerli; diğerleri atlanır. */
export const RatingsBodySchema = z.object({
  data: z.catch(
    z.array(
      z.object({
        id: z.string().check(z.minLength(1), z.maxLength(256)),
        attributes: opt(z.object({ value: z.union([z.literal(1), z.literal(-1)]) }))
      })
    ),
    []
  )
})

export const StorefrontBodySchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().check(z.regex(/^[a-z]{2}$/)),
        // B4 ek: Apple'ın bu storefront'ta desteklediği dil etiketleri (ör. `tr-TR`, `en-GB`).
        attributes: opt(z.object({ supportedLanguageTags: opt(z.array(z.string())) }))
      })
    )
    .check(z.minLength(1))
})

// --- Şema sapması (PLAN V5) -------------------------------------------------------------------
// Toleranslı şema (`opt` = z.catch) uymayan alanı sessizce `undefined` yapar. Apple'ın gerçek
// yanıtlarıyla şemanın ayrıştığını görmek için aynı yapı katı biçimde de denetlenir; uymayan
// alanların YOLU ve sorun kodu loglanır (değer loglanmaz: kişisel veri olabilir). Her (kaynak, yol,
// kod) süreç ömründe bir kez loglanır.

const strict = <T extends z.ZodMiniType>(schema: T) => z.optional(schema)
const StrictResourceSchema = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(256)),
  type: strict(z.string()),
  attributes: strict(
    z.object({
      name: strict(z.string()),
      artistName: strict(z.string()),
      albumName: strict(z.string()),
      durationInMillis: strict(z.number().check(z.gte(0))),
      playParams: strict(
        z.object({ id: z.string(), kind: z.string(), catalogId: strict(z.string()) })
      ),
      artwork: strict(z.object({ url: strict(z.string()) })),
      description: strict(z.object({ standard: strict(z.string()), short: strict(z.string()) })),
      canEdit: strict(z.boolean()),
      isrc: strict(z.string().check(z.regex(ISRC_PATTERN)))
    })
  )
})

/** Öğelerdeki şema sapmalarını `yol:kod` biçiminde (tekrarsız) döner. */
function schemaDrift(items: readonly unknown[]): string[] {
  const found = new Set<string>()
  for (const item of items) {
    const parsed = StrictResourceSchema.safeParse(item)
    if (parsed.success) continue
    for (const issue of parsed.error.issues) {
      found.add(`${issue.path.map(String).join('.') || '(kök)'}:${issue.code}`)
    }
  }
  return [...found].sort()
}

/** API yolundaki kimlikleri (`p.abc`, `i.abc`, `123`) `:id` ile değiştirir (loglar için). */
export function pathLabel(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[a-z]\.[A-Za-z0-9]+$/.test(seg) ? ':id' : seg))
    .join('/')
}

const reportedDrift = new Set<string>()

/** Yeni görülen sapmaları bir kez bildirir (`report` yalnızca yol ve kodu alır). */
export function reportSchemaDrift(
  label: string,
  items: readonly unknown[],
  report: (message: string) => void
): void {
  const fresh = schemaDrift(items).filter((d) => !reportedDrift.has(`${label}|${d}`))
  if (fresh.length === 0) return
  for (const d of fresh) reportedDrift.add(`${label}|${d}`)
  report(`${label}: şemaya uymayan alanlar (değerler loglanmaz): ${fresh.join(', ')}`)
}

/** Testler için: bildirilen sapma kaydını sıfırlar. */
export function resetSchemaDriftForTests(): void {
  reportedDrift.clear()
}

/** Geçersiz öğeleri atarak kaynak listesini doğrular. */
export function parseResources(items: readonly unknown[]): {
  resources: Resource[]
  dropped: number
} {
  const resources: Resource[] = []
  for (const item of items) {
    const parsed = ResourceSchema.safeParse(item)
    if (parsed.success) resources.push(parsed.data)
  }
  return { resources, dropped: items.length - resources.length }
}

/** `{w}x{h}` şablonlu Apple kapak URL'sini boyutlandırır; https değilse null. */
export function artworkUrl(template: string | undefined, size = 300): string | null {
  if (!template) return null
  const url = template.replace('{w}', String(size)).replace('{h}', String(size))
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const playParamsOf = (r: Resource): Track['playParams'] =>
  r.attributes?.playParams
    ? {
        id: r.attributes.playParams.id,
        kind: r.attributes.playParams.kind,
        ...(r.attributes.playParams.catalogId !== undefined
          ? { catalogId: r.attributes.playParams.catalogId }
          : {})
      }
    : null

const isExplicit = (r: Resource): boolean => r.attributes?.contentRating === 'explicit'

export const toTrack = (r: Resource): Track => ({
  id: r.id,
  name: r.attributes?.name ?? '',
  artistName: r.attributes?.artistName ?? '',
  albumName: r.attributes?.albumName ?? '',
  durationMs: r.attributes?.durationInMillis ?? null,
  playParams: playParamsOf(r),
  artworkUrl: artworkUrl(r.attributes?.artwork?.url),
  // Yalnızca varsa (eski kayıtlar ve testlerle biçim aynı kalsın).
  ...(isExplicit(r) ? { explicit: true } : {}),
  ...(r.attributes?.trackNumber !== undefined ? { trackNumber: r.attributes.trackNumber } : {}),
  ...(r.attributes?.discNumber !== undefined ? { discNumber: r.attributes.discNumber } : {})
})

export const toAlbum = (r: Resource): Album => ({
  id: r.id,
  name: r.attributes?.name ?? '',
  artistName: r.attributes?.artistName ?? '',
  trackCount: r.attributes?.trackCount ?? null,
  playParams: playParamsOf(r),
  artworkUrl: artworkUrl(r.attributes?.artwork?.url),
  ...(isExplicit(r) ? { explicit: true } : {}),
  ...(r.attributes?.releaseDate !== undefined ? { releaseDate: r.attributes.releaseDate } : {})
})

/** §3.6: kütüphane şarkısı + tür ve besteci (yalnızca yerel DB'ye yazılır, arayüze gitmez). */
export interface LibrarySong extends Track {
  genre?: string | null
  composer?: string | null
}
/** §3.6: kütüphane albümü + tür ve derleme bilgisi. */
export interface LibraryAlbum extends Album {
  genre?: string | null
  compilation?: boolean
}

/** Kütüphane öğesinin katalog karşılığının öznitelikleri (`include=catalog`). */
const catalogAttributes = (r: Resource): Resource['attributes'] => {
  const parsed = ResourceSchema.safeParse(r.relationships?.catalog?.data[0])
  return parsed.success ? parsed.data.attributes : undefined
}
/** İlk tür; Apple'ın genel "Müzik" türü atlanır. */
const primaryGenre = (r: Resource): string | null =>
  (r.attributes?.genreNames ?? []).find((g) => g !== 'Music' && g !== 'Müzik')?.trim() || null

export const toLibrarySong = (r: Resource): LibrarySong => ({
  ...toTrack(r),
  genre: primaryGenre(r),
  composer: catalogAttributes(r)?.composerName?.trim() || null
})

export const toLibraryAlbum = (r: Resource): LibraryAlbum => ({
  ...toAlbum(r),
  genre: primaryGenre(r),
  compilation: catalogAttributes(r)?.isCompilation === true
})

/**
 * Kütüphane sanatçısı: Apple kütüphane kaydında görsel yok (gözlem 2026-10-15: Sanatçılar ızgarası
 * hep yer tutucuydu); görsel katalog ilişkisinden (`include=catalog`).
 */
export const toLibraryArtist = (r: Resource): Artist => ({
  ...toArtist(r),
  artworkUrl: artworkUrl(r.attributes?.artwork?.url ?? catalogAttributes(r)?.artwork?.url)
})

const CARD_KIND: Record<string, Card['kind']> = {
  albums: 'album',
  'library-albums': 'album',
  playlists: 'playlist',
  'library-playlists': 'playlist',
  stations: 'station',
  songs: 'song',
  'library-songs': 'song',
  artists: 'artist',
  'library-artists': 'artist'
}

/** Liste/ızgara öğesi; desteklenmeyen tür (ör. müzik videosu) `null` (atlanır). */
export const toCard = (r: Resource): Card | null => {
  const kind = r.type ? CARD_KIND[r.type] : undefined
  if (!kind) return null
  const a = r.attributes
  return {
    kind,
    id: r.id,
    name: a?.name ?? '',
    subtitle: a?.artistName ?? a?.curatorName ?? a?.stationProviderName ?? '',
    artworkUrl: artworkUrl(a?.artwork?.url),
    playParams: playParamsOf(r),
    ...(isExplicit(r) ? { explicit: true } : {}),
    ...(a?.isLive !== undefined ? { isLive: a.isLive } : {}),
    ...(kind === 'station' && a?.editorialNotes?.tagline
      ? { tagline: plainText(a.editorialNotes.tagline) }
      : {})
  }
}

export const toArtist = (r: Resource): Artist => ({
  id: r.id,
  name: r.attributes?.name ?? '',
  artworkUrl: artworkUrl(r.attributes?.artwork?.url)
})

/**
 * Apple'ın editoryal metinleri (not, açıklama) HTML etiketi içerir (B5 gözlemi: `<i>`, `<br>`).
 * Arayüz HTML render etmez (Güvenlik kuralı 5): etiketler ayıklanır, satır sonları korunur, yaygın
 * varlıklar çözülür. Sonuç yalnızca metin olarak gösterilir.
 */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const textOf = (t: { standard?: string | undefined; short?: string | undefined } | undefined) => {
  const raw = t?.standard ?? t?.short
  return raw ? plainText(raw) : null
}

/** Editoryal not (uzun, yoksa kısa) düz metin; yoksa `null`. */
export const editorialNoteOf = (r: Resource): string | null => textOf(r.attributes?.editorialNotes)

export const toPlaylist = (r: Resource): Playlist => ({
  id: r.id,
  name: r.attributes?.name ?? '',
  description: textOf(r.attributes?.description) ?? '',
  canEdit: r.attributes?.canEdit ?? false,
  artworkUrl: artworkUrl(r.attributes?.artwork?.url)
})
