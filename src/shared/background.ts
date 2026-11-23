import { z } from 'zod/mini'

// Müzik arka planı katmanının ortak modeli (PLAN 3.A). UI'dan ve süreçlerden bağımsızdır; worker
// üretir, renderer okur (MessagePort sözleşmesi: ipc-contract.ts). Dış kaynaktan gelen tüm metinler
// düz metindir ve her zaman textContent ile render edilir.

const text = (max: number) => z.string().check(z.maxLength(max))
const Mbid = z
  .string()
  .check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/))

/** Eşleştirme girdisi: çalan/aranan şarkının katalog bilgisi (kullanıcı bilgisi İÇERMEZ). */
export const TrackRefSchema = z.strictObject({
  title: z.string().check(z.trim(), z.minLength(1), z.maxLength(300)),
  artist: z.string().check(z.trim(), z.minLength(1), z.maxLength(300)),
  album: z.optional(z.string().check(z.trim(), z.maxLength(300))),
  /** ISRC: ülke (2) + kayıt sahibi (3) + yıl (2) + numara (5). */
  isrc: z.optional(z.string().check(z.regex(/^[A-Za-z]{2}[A-Za-z0-9]{3}\d{7}$/))),
  durationMs: z.optional(z.number().check(z.int(), z.gte(0), z.lte(86_400_000))),
  /**
   * Apple katalog şarkı id'si (V8). ISRC yoksa worker bununla Apple'dan ISRC çözer (kütüphane
   * öğelerinde MusicKit ISRC vermez). Cache anahtarına girmez.
   */
  appleId: z.optional(z.string().check(z.regex(/^\d{1,20}$/)))
})
export type TrackRef = z.infer<typeof TrackRefSchema>

const MATCH_STATUSES = ['matched', 'uncertain', 'none'] as const

/**
 * MusicBrainz eşleşmesi (PLAN 3.A2). `uncertain`: aday var ama güven düşük; arayüz bunu kesin
 * bilgi gibi göstermez. `none`: güvenilir aday yok.
 */
export const MatchSchema = z.object({
  status: z.enum(MATCH_STATUSES),
  /** 0..1 */
  confidence: z.number().check(z.gte(0), z.lte(1)),
  method: z.nullable(z.enum(['isrc', 'search'])),
  recording: z.nullable(
    z.object({
      mbid: Mbid,
      title: text(1_000),
      lengthMs: z.nullable(z.number()),
      /** Kaynaktaki görünen sanatçı adı (ör. "A feat. B"). */
      artistCredit: text(1_000),
      artists: z.array(z.object({ mbid: Mbid, name: text(1_000) }))
    })
  ),
  release: z.nullable(z.object({ mbid: Mbid, title: text(1_000), date: z.nullable(text(32)) }))
})
export type Match = z.infer<typeof MatchSchema>

// --- Kaynaklar ve krediler (PLAN 3.A3, 3.A6) ---------------------------------------------------

/** Verinin geldiği kaynak; her alan bunu taşır. */
export const BACKGROUND_SOURCES = ['musicbrainz', 'wikidata', 'wikipedia'] as const
export type BackgroundSource = (typeof BACKGROUND_SOURCES)[number]
const Source = z.enum(BACKGROUND_SOURCES)

/** Kaynaktan bağımsız rol kümesi; kaynağın kendi rol adı `rawRole`'da korunur. */
export const CREDIT_ROLES = [
  'composer',
  'lyricist',
  'writer',
  'arranger',
  'producer',
  'engineer',
  'recording',
  'mix',
  'mastering',
  'remixer',
  'programming',
  'performer',
  'vocal',
  'instrument',
  'design',
  'other'
] as const
export type CreditRole = (typeof CREDIT_ROLES)[number]

/** Kredinin ait olduğu düzey: kayıt, eser (beste/söz), yayın (albüm) veya tek parça (Discogs). */
const CREDIT_SCOPES = ['recording', 'work', 'release', 'track'] as const

export const CreditSchema = z.object({
  role: z.enum(CREDIT_ROLES),
  /** Kaynaktaki rol adı (ör. "recorded at" değil, "producer", "Written-By"). */
  rawRole: text(200),
  name: text(500),
  mbid: z.nullable(Mbid),
  /** Enstrüman / vokal türü vb. (ör. "guitar", "lead vocals"). */
  attributes: z.array(text(200)),
  scope: z.enum(CREDIT_SCOPES),
  source: Source
})
export type Credit = z.infer<typeof CreditSchema>

/** Kayıt yeri / stüdyo (MusicBrainz "recorded at", "mixed at" ...). */
export const StudioSchema = z.object({
  name: text(500),
  mbid: z.nullable(Mbid),
  area: z.nullable(text(500)),
  /** Kaynaktaki ilişki adı (ör. "recorded at"). */
  rawRole: text(200),
  begin: z.nullable(text(32)),
  end: z.nullable(text(32)),
  source: Source
})
export type Studio = z.infer<typeof StudioSchema>

export const LabelSchema = z.object({
  name: text(500),
  mbid: z.nullable(Mbid),
  catalogNumber: z.nullable(text(200)),
  source: Source
})
export type Label = z.infer<typeof LabelSchema>

export const WorkSchema = z.object({ title: text(1_000), mbid: z.nullable(Mbid), source: Source })
export type Work = z.infer<typeof WorkSchema>

/** Tarih/metin gibi tek bir değer + kaynağı. */
const sourced = <T extends z.ZodMiniType>(value: T) => z.object({ value, source: Source })
export type Sourced<T> = { value: T; source: BackgroundSource }

/**
 * Sample ilişkisi (MusicBrainz kayıt → kayıt "samples material"). `samples`: bu şarkının kullandığı
 * kayıtlar (ileri yön); `sampledBy`: bu şarkıyı kullananlar (geri yön).
 */
export const SampleRefSchema = z.object({
  title: text(1_000),
  artist: text(1_000),
  mbid: Mbid,
  source: Source
})
export type SampleRef = z.infer<typeof SampleRefSchema>

/** Bir yönde en fazla bu kadar sample tutulur (çok kullanılan kayıtlarda yüzlerce olabilir). */
export const MAX_SAMPLES = 50

// --- Sanatçı özeti (PLAN 3.A4) ------------------------------------------------------------------

export const SUMMARY_LANGS = ['tr', 'en'] as const
export type SummaryLang = (typeof SUMMARY_LANGS)[number]

/**
 * Wikipedia sanatçı özeti. Wikipedia metni CC BY-SA 4.0'dır: kaynak URL'si ve lisans HER ZAMAN
 * metinle birlikte saklanır ve arayüzde atıf olarak gösterilir.
 */
export const ArtistSummarySchema = z.object({
  artistName: text(500),
  artistMbid: Mbid,
  /** Wikidata öğesi (ör. Q15862); veri CC0. */
  wikidataId: z.string().check(z.regex(/^Q\d{1,12}$/)),
  wikidataUrl: text(200),
  text: text(5_000),
  lang: z.enum(SUMMARY_LANGS),
  title: text(500),
  url: text(2_000),
  license: z.literal('CC BY-SA 4.0'),
  licenseUrl: z.literal('https://creativecommons.org/licenses/by-sa/4.0/'),
  source: z.literal('wikipedia'),
  fetchedAt: z.number()
})
export type ArtistSummary = z.infer<typeof ArtistSummarySchema>

/**
 * Kaynak listesi + atıf: arayüz verinin yanında gösterir. Wikipedia: CC BY-SA 4.0 + makale
 * bağlantısı.
 */
export const SourceEntrySchema = z.object({
  source: Source,
  url: z.nullable(text(2_000)),
  /** Gösterilecek atıf metni (kaynak dilinde, şartın istediği biçimde). */
  attribution: text(500),
  license: z.nullable(text(100)),
  fetchedAt: z.number()
})
export type SourceEntry = z.infer<typeof SourceEntrySchema>

// --- Birleşik model (PLAN 3.A6) ----------------------------------------------------------------

/**
 * Bir şarkının arka planı. Her alan/öğe geldiği kaynağı taşır (ayrıntı: docs/BACKGROUND.md).
 * `match.status` `uncertain` ise
 * arayüz veriyi "olası" diye işaretler; `none` ise yalnızca ön yükleme yapılmış boş sonuçtur.
 */
export const TrackBackgroundSchema = z.object({
  /**
   * 2: `samples`; 3: sample yoksa sürüm ilişkisinden; 4: Discogs/Last.fm alanları kalktı (R3). Eski
   * önbellek şemadan geçmez → yeniden toplanır.
   */
  version: z.literal(4),
  match: MatchSchema,
  /** Kayıt, yayın ve parça düzeyi krediler (eser kredileri `work` altında). */
  credits: z.array(CreditSchema),
  recording: z.object({
    /** Kayıt tarihi (stüdyo oturumu başlangıcı). */
    recordedDate: z.nullable(sourced(text(32))),
    /** Çıkış tarihi (seçilen yayın; yoksa ilk çıkış). */
    releaseDate: z.nullable(sourced(text(32))),
    releaseTitle: z.nullable(sourced(text(1_000))),
    studios: z.array(StudioSchema),
    labels: z.array(LabelSchema)
  }),
  work: z.object({
    works: z.array(WorkSchema),
    composers: z.array(CreditSchema),
    lyricists: z.array(CreditSchema),
    /** Söz ve müzik birlikte (MusicBrainz "writer"). */
    writers: z.array(CreditSchema)
  }),
  samples: z.object({
    samples: z.array(SampleRefSchema).check(z.maxLength(MAX_SAMPLES)),
    sampledBy: z.array(SampleRefSchema).check(z.maxLength(MAX_SAMPLES))
  }),
  artistSummary: z.nullable(ArtistSummarySchema),
  sources: z.array(SourceEntrySchema),
  fetchedAt: z.number()
})
export type TrackBackground = z.infer<typeof TrackBackgroundSchema>

// --- Kademeli sonuç (PLAN 3.A8) ----------------------------------------------------------------

/** Toplama aşamaları, bildirim sırasıyla: eşleştirme → MusicBrainz kredileri → özet. */
export const BACKGROUND_STAGES = ['match', 'credits', 'summary'] as const
export type BackgroundStage = (typeof BACKGROUND_STAGES)[number]

/**
 * Bölüm durumu: `pending` sürüyor · `ready` veri var · `unavailable` kaynakta veri yok / kaynak kapalı
 * (kalıcı, hata değil) · `error` geçici hata (ağ, kaynak): sonuç eksiktir, tam sayılmaz.
 */
export const SECTION_STATUSES = ['pending', 'ready', 'unavailable', 'error'] as const
export type SectionStatus = (typeof SECTION_STATUSES)[number]
const SectionStatusSchema = z.enum(SECTION_STATUSES)

export const SectionsSchema = z.object({
  match: SectionStatusSchema,
  credits: SectionStatusSchema,
  summary: SectionStatusSchema
})
export type Sections = z.infer<typeof SectionsSchema>

/** Bir aşama bitince bildirilen ara sonuç (`background:progress`). */
export const BackgroundProgressSchema = z.object({
  /** İsteğin `requestId`'si: renderer yalnızca kendi isteğinin ilerlemesini alır. */
  requestId: z.string().check(z.maxLength(64)),
  key: z.string().check(z.maxLength(128)),
  lang: z.enum(SUMMARY_LANGS),
  stage: z.enum(BACKGROUND_STAGES),
  sections: SectionsSchema,
  /** İstek başlangıcından bu aşamanın bitişine kadar geçen süre (ms). */
  atMs: z.number(),
  /** Aşamanın kendi süresi (ms). */
  tookMs: z.number(),
  /** Tüm aşamalar bitti (hiçbiri `pending` değil). */
  done: z.boolean(),
  /** Şimdiye kadar toplananlarla birleştirilmiş ara model; `pending` bölümler boştur. */
  data: TrackBackgroundSchema
})
export type BackgroundProgress = z.infer<typeof BackgroundProgressSchema>
