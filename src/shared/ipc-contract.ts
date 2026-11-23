// zod/mini: tree-shake edilebilir; sandbox'lı preload'a gömüldüğü için bundle küçük kalır.
import { z } from 'zod/mini'
import { SettingsPatchSchema, SettingsSchema } from './settings'
import type { IpcResult } from './result'
import { MAX_ARTWORK_URL_LENGTH } from './artwork'
import {
  BackgroundProgressSchema,
  SectionsSchema,
  SUMMARY_LANGS,
  TrackBackgroundSchema,
  TrackRefSchema
} from './background'
import { LyricsSchema } from './lyrics'
import { TRACK_QUERY_MAX } from './trackQuery'

// IPC sözleşmesi (PLAN 1.3a) — TEK KAYNAK. Her kanal adı ve yükünün zod şeması burada tanımlıdır:
//  - main her çağrının argümanlarını bu şemalarla doğrular, geçersizse reddeder ve loglar;
//  - preload yalnızca buradaki kanallar için sabit kanallı fonksiyonlar açar (genel invoke yok);
//  - worker, renderer'dan MessagePort ile gelen her isteği buradaki şemalarla doğrular (1.7a);
//  - renderer tipleri buradan türetilir.
// Yeni kanal yalnızca buraya eklenerek açılır (Güvenlik kuralı 3 ve 4).

// --- Ortak şemalar ---------------------------------------------------------------------------

/**
 * Music User Token: boş olmayan, boşluk/kontrol karakteri içermeyen yazdırılabilir ASCII.
 * Üst sınır, bozuk/kötü amaçlı büyük yüklerin diske yazılmasını engeller.
 */
export const UserTokenSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(16_384), z.regex(/^[\x21-\x7e]+$/))

/**
 * Oturum: Music User Token + hesabın içerik kısıtlaması (Apple `itre`; bilinmiyorsa `null`).
 * MusicKit'e `restrictedEnabled` olarak verilir (V4 bulgusu: `tr` mağazasında varsayılan kısıtlı).
 */
export const AuthSessionSchema = z.object({
  token: UserTokenSchema,
  restricted: z.nullable(z.boolean())
})
export type AuthSession = z.infer<typeof AuthSessionSchema>

export const DeveloperTokenInfoSchema = z.object({
  token: z.string(),
  /** Unix saniyesi */
  expiresAt: z.number()
})

/** Widevine CDM durumu (PLAN 1.2R). */
export const CdmStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('pending') }),
  z.object({ state: z.literal('ready') }),
  z.object({ state: z.literal('error'), message: z.string() })
])

/** Apple kaynak kimliği (katalog `123`, kütüphane `p.abc`, `i.abc`). */
const ResourceIdSchema = z.string().check(z.minLength(1), z.maxLength(256))

const intRange = (min: number, max: number) => z.number().check(z.int(), z.gte(min), z.lte(max))

export const TrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artistName: z.string(),
  albumName: z.string(),
  durationMs: z.nullable(z.number()),
  /** MusicKit oynatma parametreleri (kütüphane öğeleri için catalogId içerir). */
  playParams: z.nullable(
    z.object({ id: z.string(), kind: z.string(), catalogId: z.optional(z.string()) })
  ),
  /** Yalnızca https; aksi halde null. */
  artworkUrl: z.nullable(z.string()),
  /** Apple `contentRating: explicit` (arayüzde "E" işareti). */
  explicit: z.optional(z.boolean()),
  /** Albüm sayfasında sıralama/numara (yalnızca albüm detayında gelir). */
  trackNumber: z.optional(z.nullable(z.number())),
  discNumber: z.optional(z.nullable(z.number()))
})

export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  canEdit: z.boolean(),
  artworkUrl: z.nullable(z.string())
})

export const SearchResultsSchema = z.object({
  songs: z.array(TrackSchema),
  playlists: z.array(PlaylistSchema)
})

const PlayParamsSchema = z.nullable(
  z.object({ id: z.string(), kind: z.string(), catalogId: z.optional(z.string()) })
)

/** Albüm (katalog veya kütüphane; 3.B1). */
export const AlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  artistName: z.string(),
  trackCount: z.nullable(z.number()),
  playParams: PlayParamsSchema,
  artworkUrl: z.nullable(z.string()),
  explicit: z.optional(z.boolean()),
  /** `YYYY-MM-DD` veya `YYYY` (Apple'ın verdiği gibi). */
  releaseDate: z.optional(z.nullable(z.string()))
})

/** Sanatçı (katalog veya kütüphane; 3.B1). */
export const ArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  artworkUrl: z.nullable(z.string())
})

const CARD_KINDS = ['album', 'playlist', 'station', 'song', 'artist'] as const
/** Liste/ızgara öğesi: öneriler, listeler, son eklenenler, sanatçı görünümleri (tek biçim). */
export const CardSchema = z.object({
  kind: z.enum(CARD_KINDS),
  id: z.string(),
  name: z.string(),
  /** Sanatçı, küratör veya istasyon sağlayıcısı. */
  subtitle: z.string(),
  artworkUrl: z.nullable(z.string()),
  playParams: PlayParamsSchema,
  explicit: z.optional(z.boolean()),
  /** İstasyon canlı yayın mı (Apple Music Radio). */
  isLive: z.optional(z.boolean()),
  /** B6: istasyonun Apple tanıtım satırı (ör. "En iyi yeni müzik."); düz metin. */
  tagline: z.optional(z.string())
})

/** Bir kaynağın (katalog / kütüphane) türe göre gruplu arama sonuçları (3.B1). */
export const SearchGroupsSchema = z.object({
  /**
   * "En iyi sonuçlar" (PLAN_v5 P2; Apple `with=topResults`): türleri karışık, Apple'ın sırasıyla.
   * Yalnızca katalogda; kütüphanede boş.
   */
  top: z.array(CardSchema),
  songs: z.array(TrackSchema),
  albums: z.array(AlbumSchema),
  artists: z.array(ArtistSchema),
  playlists: z.array(PlaylistSchema),
  /** B7: radyo istasyonları (yalnızca katalogda; kütüphanede boş). */
  stations: z.array(CardSchema)
})

/**
 * Yazarken öneriler (PLAN_v5 P2; Apple `search/suggestions`, yalnızca katalog): tamamlanmış arama
 * terimleri + doğrudan açılabilecek en iyi eşleşmeler.
 */
export const SearchSuggestionsSchema = z.object({
  term: z.string(),
  terms: z.array(z.object({ searchTerm: z.string(), displayTerm: z.string() })),
  top: z.array(CardSchema)
})

/** Çökme/yeniden açılış sonrası geri yüklenecek player durumu (PLAN 1.8, tablo player_state). */
export const PlayerStateSchema = z.strictObject({
  queue: z.array(ResourceIdSchema).check(z.maxLength(5_000)),
  position: intRange(0, 5_000),
  currentTime: z.number().check(z.gte(0), z.lte(86_400))
})

// --- Player durum yayını (PLAN 1.8a) ------------------------------------------------------------
// MusicKit yalnızca ana pencerede çalışır; durum main'deki player-hub üzerinden tüm pencerelere
// yayınlanır, komutlar herhangi bir pencereden `player:command` ile gelir.

const PLAYBACK_STATES = [
  'none',
  'loading',
  'playing',
  'paused',
  'stopped',
  'ended',
  'seeking',
  'waiting',
  'stalled',
  'completed'
] as const
const REPEAT_MODES = ['none', 'one', 'all'] as const
const PLAYBACK_TYPES = ['none', 'preview', 'unencryptedFull', 'encryptedFull', 'unknown'] as const

const TextSchema = z.string().check(z.maxLength(1_000))
const SecondsSchema = z.number().check(z.gte(0), z.lte(86_400))
/** Yalnızca https (ileride <img src> olarak render edilecek). */
const HttpsUrlSchema = z.string().check(z.maxLength(2_048), z.regex(/^https:\/\//))

export const HubNowPlayingSchema = z.strictObject({
  id: ResourceIdSchema,
  title: TextSchema,
  artist: TextSchema,
  album: TextSchema,
  artworkUrl: z.nullable(HttpsUrlSchema),
  durationSec: SecondsSchema,
  /** `encryptedFull` = tam şarkı, `preview` = 30 sn önizleme. */
  playbackType: z.enum(PLAYBACK_TYPES)
})

/** Ayrık değişikliklerde (durum, şarkı, kuyruk, ayarlar) yayınlanan tam player durumu. */
export const PlayerHubStateSchema = z.strictObject({
  playbackState: z.enum(PLAYBACK_STATES),
  nowPlaying: z.nullable(HubNowPlayingSchema),
  volume: z.number().check(z.gte(0), z.lte(1)),
  shuffle: z.boolean(),
  repeat: z.enum(REPEAT_MODES),
  queue: z.strictObject({
    ids: z.array(ResourceIdSchema).check(z.maxLength(5_000)),
    position: intRange(0, 5_000),
    /** Otomatik çalma bölümünün başladığı sıra; yoksa `null` (P3). */
    autoplayIndex: z.nullable(intRange(0, 5_000))
  })
})

/** Sık değişen konum bilgisi ayrı kanaldan ve kısılarak yayınlanır (PLAN 1.8, 1.8b). */
export const PlayerTimeSchema = z.strictObject({
  currentTime: SecondsSchema,
  duration: SecondsSchema
})

export const PlayerHubSnapshotSchema = z.object({
  /** Ana pencere henüz durum yayınlamadıysa `null`. */
  state: z.nullable(PlayerHubStateSchema),
  time: PlayerTimeSchema
})

const command = <T extends string>(type: T) => z.strictObject({ type: z.literal(type) })

/** Herhangi bir pencereden (veya tray'den) gelen player komutu; main ana pencereye iletir. */
export const PlayerCommandSchema = z.discriminatedUnion('type', [
  command('play'),
  command('pause'),
  command('togglePlay'),
  command('stop'),
  command('next'),
  command('previous'),
  z.strictObject({ type: z.literal('seek'), seconds: SecondsSchema }),
  z.strictObject({ type: z.literal('setVolume'), volume: z.number().check(z.gte(0), z.lte(1)) }),
  z.strictObject({ type: z.literal('setShuffle'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('setRepeat'), mode: z.enum(REPEAT_MODES) }),
  z.strictObject({ type: z.literal('playQueueIndex'), index: intRange(0, 4_999) })
])

/** Senkronizasyon kapsamı: playlist listesi veya tek bir playlist'in şarkıları. */
export const LibraryScopeSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('playlists') }),
  z.strictObject({ scope: z.literal('playlistTracks'), playlistId: ResourceIdSchema }),
  z.strictObject({ scope: z.literal('songs') }),
  z.strictObject({ scope: z.literal('albums') }),
  z.strictObject({ scope: z.literal('artists') })
])

const SearchTermSchema = z.string().check(z.trim(), z.minLength(1), z.maxLength(200))
const MessageParamsSchema = z.record(
  z.string().check(z.maxLength(64)),
  z.union([z.string().check(z.maxLength(1_000)), z.number()])
)
/** Süreç sınırlarındaki hata: katalog kodu + teknik mesaj + kullanıcı mesajı parametreleri. */
const WireErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  params: z.optional(MessageParamsSchema)
})

/**
 * Birleşik arama sonucu (3.B1): katalog ve kütüphane aynı anda aranır; biri başarısız olursa diğeri
 * yine döner (hata ilgili alanda). Kapsam dışı kalan veya giriş yokken aranmayan kaynak `null`.
 */
export const UnifiedSearchSchema = z.object({
  term: z.string(),
  catalog: z.nullable(SearchGroupsSchema),
  library: z.nullable(SearchGroupsSchema),
  catalogError: z.nullable(WireErrorSchema),
  libraryError: z.nullable(WireErrorSchema)
})

export const SEARCH_SCOPES = ['all', 'catalog', 'library'] as const

/** Kendi pencere çubuğumuzun düğmeleri (B1). */
export const WINDOW_ACTIONS = ['minimize', 'toggleMaximize', 'close'] as const
export type WindowAction = (typeof WINDOW_ACTIONS)[number]
export const WindowStateSchema = z.strictObject({ maximized: z.boolean(), focused: z.boolean() })
export type WindowState = z.infer<typeof WindowStateSchema>

/** Panoya kopyalanabilen tek biçim: Apple Music içerik bağlantısı (mağaza + tür + katalog id). */
export const APPLE_MUSIC_LINK =
  /^https:\/\/music\.apple\.com\/[a-z]{2}\/(song|album|playlist|artist|station)\/[A-Za-z0-9.-]{1,64}$/

/**
 * Müzik arka planı / Hakkında kaynak bağlantıları (2026-10-14): Wikipedia lisansı (CC BY-SA 4.0) makale
 * bağlantısı + lisans bağlantısı ister. Yalnızca bu kalıplar tarayıcıda açılabilir; main ayrıca
 * doğrular (`main/externalLinks.ts` `sourceLinkUrl`).
 */
export const SOURCE_LINK =
  /^https:\/\/(?:(?:tr|en)\.wikipedia\.org\/wiki\/[A-Za-z0-9%_.,()'!~*:-]{1,300}|www\.wikidata\.org\/wiki\/Q[0-9]{1,12}|musicbrainz\.org\/(?:recording|release|artist|work)\/[0-9a-f-]{36}|creativecommons\.org\/licenses\/by-sa\/4\.0\/|(?:musicbrainz\.org|lrclib\.net|www\.wikidata\.org|www\.wikipedia\.org)\/)$/

/** Uygulama dışında açılabilen bağlantıların anahtarları (P4). */
export const EXTERNAL_LINKS = ['manageSubscriptions'] as const
export type ExternalLink = (typeof EXTERNAL_LINKS)[number]

// --- Arayüz veri kapsamı (altyapı bitiş kriteri: Ana Sayfa, Göz At, Radyo, Kütüphane, detaylar) ----

/** Arayüz dili (Apple başlıkları bu dilde istenir; storefront desteklemiyorsa varsayılan dil). */
const LocaleSchema = z.enum(['tr', 'en'])

/** Şarkı menüsü: "Albüme Git" / "Sanatçıya Git" için şarkının katalog albümü ve sanatçısı. */
export const SongLinksSchema = z.object({
  albumId: z.nullable(z.string()),
  albumName: z.string(),
  albumArtworkUrl: z.nullable(z.string()),
  artistId: z.nullable(z.string()),
  artistName: z.string()
})

/** B6: Apple türü (listeler için) veya radyo türü (istasyonlar için); ad arayüz dilinde. */
export const GenreSchema = z.object({ id: z.string(), name: z.string() })

export const CardGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  cards: z.array(CardSchema)
})
export const AlbumDetailSchema = z.object({
  album: AlbumSchema,
  tracks: z.array(TrackSchema),
  genres: z.array(z.string()),
  copyright: z.nullable(z.string()),
  recordLabel: z.nullable(z.string()),
  /** Apple editoryal notu: HTML etiketleri ayıklanmış düz metin (metin olarak render edilir). */
  editorialNote: z.nullable(z.string()),
  /** B5: albüm sanatçısının katalog id'si (sanatçı adına basınca sayfası açılır). */
  artistId: z.nullable(z.string()),
  /** B5: ses türleri (Apple `audioVariants`, ör. `lossless`, `dolby-atmos`). */
  audioVariants: z.array(z.string()),
  /** B5: Apple görünümleri (Diğer Versiyonlar, İlgili Albümler, Şurada Yer Alıyor); başlıklar Apple'dan. */
  sections: z.array(CardGroupSchema)
})
export const ArtistDetailSchema = z.object({
  artist: ArtistSchema,
  topSongs: z.array(TrackSchema),
  latestRelease: z.nullable(AlbumSchema),
  albums: z.array(AlbumSchema),
  singles: z.array(AlbumSchema),
  similarArtists: z.array(ArtistSchema),
  /** B5: Apple'ın görünüm başlıkları (ör. "Popüler Parçalar", "Son Çıkan"); yoksa arayüz metni. */
  topSongsTitle: z.nullable(z.string()),
  latestReleaseTitle: z.nullable(z.string()),
  genres: z.array(z.string()),
  editorialNote: z.nullable(z.string()),
  /** B5: sayfadaki raflar, Apple Music sırasıyla (Albümler, Single'lar ve EP'ler, …, Benzer Sanatçılar). */
  sections: z.array(CardGroupSchema)
})
export const PlaylistDetailSchema = z.object({
  playlist: PlaylistSchema,
  curatorName: z.string(),
  tracks: z.array(TrackSchema),
  /** B5: Apple görünümleri (Öne Çıkan Sanatçılar). */
  sections: z.array(CardGroupSchema)
})
export const LIBRARY_SORTS = ['name', 'artist', 'recent'] as const
/**
 * Playlist sıralaması (geliştirici isteği 2026-10-14; Apple Music "Sırala" menüsü gibi). Yalnızca
 * görünümdür: Apple'daki playlist sırası değişmez. `order` + `desc` = en son eklenen en üstte.
 */
const PLAYLIST_SORT_FIELDS = ['order', 'title', 'artist', 'album', 'duration'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const
export const PlaylistSortSchema = z.strictObject({
  by: z.enum(PLAYLIST_SORT_FIELDS),
  dir: z.enum(SORT_DIRECTIONS)
})
const LibraryPageParams = z.strictObject({
  offset: z.optional(intRange(0, 1_000_000)),
  limit: z.optional(intRange(1, 500)),
  sort: z.optional(z.enum(LIBRARY_SORTS))
})
const pageOf = <T extends z.ZodMiniType>(item: T) =>
  z.object({
    items: z.array(item),
    offset: z.number(),
    total: z.number(),
    syncedAt: z.nullable(z.number())
  })

/** §3.6: ad + şarkı sayısı listesi (türler, besteciler). */
const NamedCountsSchema = z.object({
  items: z.array(z.object({ name: z.string(), count: z.number() })),
  syncedAt: z.nullable(z.number())
})

// --- Kütüphane yazma (3.B2) ------------------------------------------------------------------------
const IdListSchema = z.optional(z.array(ResourceIdSchema).check(z.maxLength(100)))
/** Kütüphaneye / favorilere eklenecek katalog öğeleri. */
export const LibraryIdsSchema = z.strictObject({
  songs: IdListSchema,
  albums: IdListSchema,
  playlists: IdListSchema
})
export const RATING_KINDS = [
  'songs',
  'library-songs',
  'albums',
  'library-albums',
  'playlists',
  'library-playlists'
] as const
export const RatingValueSchema = z.nullable(z.union([z.literal(1), z.literal(-1)]))
/** Yazma sonucu: `queued` = çevrimdışı/geçici hata, bağlanınca gönderilecek (yerelde uygulandı). */
const WriteResultSchema = z.object({ queued: z.boolean() })

// --- Renderer → main (invoke) ----------------------------------------------------------------

interface InvokeDef {
  channel: string
  /** Argüman listesi; fazladan argüman da reddedilir. */
  args: z.ZodMiniTuple
  result: z.ZodMiniType
}

export const invokeContract = {
  getDeveloperToken: {
    channel: 'token:getDeveloperToken',
    args: z.tuple([]),
    result: DeveloperTokenInfoSchema
  },
  /** Kayıtlı oturum (token + kısıtlama); yoksa (veya bozuksa) `null`. */
  loadSession: {
    channel: 'auth:loadSession',
    args: z.tuple([]),
    result: z.nullable(AuthSessionSchema)
  },
  /**
   * YALNIZCA ana pencere: Apple giriş penceresini açar (main, opener'sız); başarılı girişte token
   * şifreli depoya ve worker'a yazılır ve MusicKit'e verilmek üzere döndürülür (V3). Renderer'ın
   * token YAZABİLDİĞİ bir kanal yoktur.
   */
  authorize: {
    channel: 'auth:authorize',
    args: z.tuple([]),
    result: AuthSessionSchema
  },
  /** Token'ı ve yerel kullanıcı verisini (DB) siler: çıkış veya 401. */
  clearUserToken: {
    channel: 'auth:clearUserToken',
    args: z.tuple([]),
    result: z.null()
  },
  getCdmStatus: {
    channel: 'cdm:getStatus',
    args: z.tuple([]),
    result: CdmStatusSchema
  },
  /** Main, çağıran çerçeveye worker'a bağlı bir MessagePort'u `WORKER_PORT_CHANNEL` ile yollar. */
  connectWorker: {
    channel: 'worker:connect',
    args: z.tuple([]),
    result: z.null()
  },
  /** YALNIZCA ana pencere (MusicKit): tam player durumunu hub'a yayınlar (PLAN 1.8a). */
  publishPlayerState: {
    channel: 'player:publishState',
    args: z.tuple([PlayerHubStateSchema]),
    result: z.null()
  },
  /** YALNIZCA ana pencere: konum bilgisi (kısılmış, ≤ 1/sn). */
  publishPlayerTime: {
    channel: 'player:publishTime',
    args: z.tuple([PlayerTimeSchema]),
    result: z.null()
  },
  /** Herhangi bir pencere: o anki player durumu (yeni açılan pencere için snapshot). */
  getPlayerState: {
    channel: 'player:getState',
    args: z.tuple([]),
    result: PlayerHubSnapshotSchema
  },
  /** Herhangi bir pencere: player komutu (main ana pencereye iletir). */
  sendPlayerCommand: {
    channel: 'player:command',
    args: z.tuple([PlayerCommandSchema]),
    result: z.null()
  },
  /**
   * YALNIZCA ana pencere (PLAN 2.3): maskeli loglar + sürümler + CDM durumu + son hata kodlarıyla
   * İndirilenler'e yerel .zip yazar; yalnızca dosya adını döner. Otomatik gönderim yok.
   */
  exportDiagnostics: {
    channel: 'diagnostics:export',
    args: z.tuple([]),
    result: z.object({ fileName: z.string() })
  },
  /**
   * Apple "iTunes Store önbelleğini sıfırla" karşılığı (3.B3): kapak görseli disk önbelleği silinir.
   * Müzik arka planı önbelleği worker'dan (`clearBackgroundCache`) ayrıca silinir.
   */
  clearArtworkCache: {
    channel: 'cache:clearArtwork',
    args: z.tuple([]),
    result: z.null()
  },
  /**
   * Varsayılan tarayıcıda bilinen bir bağlantıyı açar (P4: "Aboneliği yönet"). Renderer URL
   * göndermez; yalnızca anahtar. Adresler main'de sabit (`main/externalLinks.ts`). Yalnızca ana pencere.
   */
  openExternalLink: {
    channel: 'shell:openExternalLink',
    args: z.tuple([z.enum(EXTERNAL_LINKS)]),
    result: z.null()
  },
  /**
   * Şarkı / albüm / liste menüsü "Bağlantıyı Kopyala": panoya yalnızca Apple Music bağlantısı
   * (`https://music.apple.com/{mağaza}/{tür}/{id}`) yazılabilir; başka metin reddedilir. Ana pencere.
   */
  /** Kaynak bağlantısı (Wikipedia, Wikidata, MusicBrainz, lisans): yalnızca `SOURCE_LINK`. Ana pencere. */
  openSourceLink: {
    channel: 'shell:openSourceLink',
    args: z.tuple([z.string().check(z.maxLength(400), z.regex(SOURCE_LINK))]),
    result: z.null()
  },
  copyAppleMusicLink: {
    channel: 'clipboard:copyAppleMusicLink',
    args: z.tuple([z.string().check(z.regex(APPLE_MUSIC_LINK))]),
    result: z.null()
  },
  /**
   * Çalma bağlantısını ısıt (2026-10-14): main, `PLAYBACK_WARMUP_ORIGINS`'e DNS + TLS ön bağlantısı
   * açar (veri yok). Renderer adres göndermez. Yalnızca ana pencere; main ayrıca sıklığı sınırlar.
   */
  warmupPlayback: {
    channel: 'net:warmupPlayback',
    args: z.tuple([]),
    result: z.null()
  },
  /** B1: kendi pencere çubuğu. Çağıranın KENDİ penceresine uygulanır (kayıtlı pencerelerimiz). */
  windowControl: {
    channel: 'window:control',
    args: z.tuple([z.enum(WINDOW_ACTIONS)]),
    result: z.null()
  },
  getWindowState: {
    channel: 'window:getState',
    args: z.tuple([]),
    result: WindowStateSchema
  },
  /**
   * B12b MiniPlayer (geliştirici kararı 2026-10-14): YALNIZCA ana pencere açar; ana pencere gizlenir.
   * `alwaysOnTop` ayardan (`advanced.keepMiniPlayerOnTop`) gelir.
   */
  openMiniPlayer: {
    channel: 'window:openMini',
    args: z.tuple([z.strictObject({ alwaysOnTop: z.boolean() })]),
    result: z.null()
  },
  /** YALNIZCA MiniPlayer penceresi: kendini kapatır, ana pencere geri gelir. */
  closeMiniPlayer: {
    channel: 'window:closeMini',
    args: z.tuple([]),
    result: z.null()
  }
} as const satisfies Record<string, InvokeDef>

// --- Main → renderer (bildirim) ----------------------------------------------------------------

interface EventDef {
  channel: string
  payload: z.ZodMiniType
}

export const eventContract = {
  /** CDM durumu değiştikçe çağrılır. */
  onCdmStatus: { channel: 'cdm:status', payload: CdmStatusSchema },
  /** Tüm pencereler: player durumu değişti. */
  onPlayerState: { channel: 'player:state', payload: PlayerHubStateSchema },
  /** Görünür pencereler: konum güncellemesi (gizli pencerelere gönderilmez, PLAN 1.8b). */
  onPlayerTime: { channel: 'player:time', payload: PlayerTimeSchema },
  /** Yalnızca ana pencere: hub'dan gelen, yürütülecek komut. */
  onPlayerCommand: { channel: 'player:runCommand', payload: PlayerCommandSchema },
  /** B1: pencere büyütüldü/küçüldü, odak değişti (yalnızca o pencereye). */
  onWindowState: { channel: 'window:state', payload: WindowStateSchema },
  /** Sistem uykudan uyandı (PLAN 2.3): ağ, senkron, developer token ve MusicKit yeniden denetlenir. */
  onSystemResume: {
    channel: 'system:resume',
    payload: z.strictObject({ reason: z.enum(['resume']) })
  }
} as const satisfies Record<string, EventDef>

/** Yalnızca MessagePort taşır (yükü yok); preload yakalar, renderer'a açılmaz. */
export const WORKER_PORT_CHANNEL = 'worker:port'

// --- Renderer ↔ worker (MessagePort, PLAN 1.7a) -------------------------------------------------

/** Arka plan isteği: şarkının katalog bilgisi (kullanıcı bilgisi yok) + özet dili. */
const BackgroundRequestSchema = z.strictObject({
  track: TrackRefSchema,
  lang: z.optional(z.enum(SUMMARY_LANGS)),
  /** Verilirse aşama ilerlemesi (`onBackgroundProgress`) bu kimlikle bildirilir (PLAN 3.A8). */
  requestId: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{1,64}$/)))
})

interface WorkerMethodDef {
  params: z.ZodMiniType
  result: z.ZodMiniType
}

export const workerContract = {
  /** SWR: yerel DB'den anında döner; eskiyse arka planda senkronize eder (`onLibraryChanged`). */
  getPlaylists: {
    params: z.strictObject({}),
    result: z.object({ items: z.array(PlaylistSchema), syncedAt: z.nullable(z.number()) })
  },
  /** SWR + aralıklı okuma: binlerce şarkılık playlist'ler parça parça okunur. */
  getPlaylistTracks: {
    params: z.strictObject({
      playlistId: ResourceIdSchema,
      offset: z.optional(intRange(0, 1_000_000)),
      limit: z.optional(intRange(1, 500)),
      sort: z.optional(PlaylistSortSchema),
      /** Liste içinde arama (ad/sanatçı/albüm, `shared/trackQuery`); verilirse `total` eşleşen sayısı. */
      query: z.optional(z.string().check(z.maxLength(TRACK_QUERY_MAX)))
    }),
    result: z.object({
      items: z.array(TrackSchema),
      offset: z.number(),
      total: z.number(),
      syncedAt: z.nullable(z.number())
    })
  },
  /** Zorla senkronize eder; `changed`: DB içeriği değişti mi. */
  syncLibrary: {
    params: LibraryScopeSchema,
    result: z.object({ changed: z.boolean() })
  },
  getRecentlyPlayed: {
    params: z.strictObject({ limit: z.optional(intRange(1, 50)) }),
    result: z.array(TrackSchema)
  },
  /** Storefront verilmezse kullanıcının hesabından alınır (sabit yazılmaz). */
  searchCatalog: {
    params: z.strictObject({
      term: SearchTermSchema,
      limit: z.optional(intRange(1, 25)),
      storefront: z.optional(z.string().check(z.regex(/^[a-z]{2}$/)))
    }),
    result: SearchResultsSchema
  },
  searchLibrary: {
    params: z.strictObject({ term: SearchTermSchema, limit: z.optional(intRange(1, 25)) }),
    result: SearchResultsSchema
  },
  /**
   * Birleşik arama (3.B1). Yeni arama, worker'da süren öncekini iptal eder (`REQUEST_CANCELLED`):
   * hızlı yazımda yalnızca son istek tamamlanır.
   */
  search: {
    params: z.strictObject({
      term: SearchTermSchema,
      limit: z.optional(intRange(1, 25)),
      scope: z.optional(z.enum(SEARCH_SCOPES)),
      locale: z.optional(LocaleSchema)
    }),
    result: UnifiedSearchSchema
  },
  /**
   * Yazarken öneriler (P2). Yeni istek süren öncekini iptal eder (`REQUEST_CANCELLED`), aramadan
   * bağımsız.
   */
  searchSuggestions: {
    params: z.strictObject({ term: SearchTermSchema, limit: z.optional(intRange(1, 10)) }),
    result: SearchSuggestionsSchema
  },
  /** Son aramalar (yerel; en yeni önce; çıkışta silinir). */
  getRecentSearches: {
    params: z.strictObject({ limit: z.optional(intRange(1, 50)) }),
    result: z.array(z.object({ term: z.string(), searchedAt: z.number() }))
  },
  /** Kullanıcı bir aramayı tamamladığında (sonuç seçti / Enter) eklenir. */
  addRecentSearch: {
    params: z.strictObject({ term: SearchTermSchema }),
    result: z.null()
  },
  clearRecentSearches: {
    params: z.strictObject({}),
    result: z.null()
  },
  // 3.B2 kütüphane yazma. Hepsi iyimser: yerel DB anında güncellenir (değişiklik bildirimi gider),
  // Apple reddederse geri alınır (hata döner); ağ yoksa kuyruğa alınır (`queued: true`).
  addToLibrary: { params: LibraryIdsSchema, result: WriteResultSchema },
  /** Favorilere ekle; `alsoAddToLibrary` Apple Music "Favorilere eklerken kütüphaneye ekle" ayarı. */
  addToFavorites: {
    params: z.strictObject({ ids: LibraryIdsSchema, alsoAddToLibrary: z.optional(z.boolean()) }),
    result: WriteResultSchema
  },
  createPlaylist: {
    params: z.strictObject({
      name: z.string().check(z.trim(), z.minLength(1), z.maxLength(100)),
      description: z.optional(z.string().check(z.maxLength(1_000))),
      tracks: z.optional(z.array(TrackSchema).check(z.maxLength(100)))
    }),
    result: z.object({ playlist: PlaylistSchema, queued: z.boolean() })
  },
  /** Playlist'in sonuna ekler; `alsoAddToLibrary` "Playlist'e eklerken kütüphaneye ekle" ayarı. */
  addTracksToPlaylist: {
    params: z.strictObject({
      playlistId: ResourceIdSchema,
      tracks: z.array(TrackSchema).check(z.minLength(1), z.maxLength(100)),
      alsoAddToLibrary: z.optional(z.boolean())
    }),
    result: WriteResultSchema
  },
  /** Sev (1) / sevme (-1) / kaldır (null). */
  setRating: {
    params: z.strictObject({
      kind: z.enum(RATING_KINDS),
      id: ResourceIdSchema,
      value: RatingValueSchema
    }),
    result: WriteResultSchema
  },
  /** Yerel puanlar anında; `refresh` ise Apple'dan da okunur. Puanı olmayan öğe `null`. */
  getRatings: {
    params: z.strictObject({
      kind: z.enum(RATING_KINDS),
      ids: z.array(ResourceIdSchema).check(z.minLength(1), z.maxLength(100)),
      refresh: z.optional(z.boolean())
    }),
    result: z.array(z.object({ id: z.string(), value: RatingValueSchema }))
  },
  /** Bekleyen yazmaları gönderir (bağlantı geri gelince / açılışta renderer çağırır). */
  flushPendingWrites: {
    params: z.strictObject({}),
    result: z.object({ sent: z.number(), remaining: z.number() })
  },
  /** Ayarlar (3.B3): her zaman geçerli ve güncel sürümde döner. */
  getSettings: { params: z.strictObject({}), result: SettingsSchema },
  /**
   * Bölüm bazında kısmi güncelleme; geçersiz değer INVALID_ARGUMENT ile reddedilir (hiçbiri yazılmaz).
   * Başarılıysa tüm pencerelere `onSettingsChanged` gider.
   */
  updateSettings: { params: SettingsPatchSchema, result: SettingsSchema },
  /** Apple "iTunes Store önbelleğini sıfırla" karşılığı: müzik arka planı önbelleği silinir. */
  clearBackgroundCache: { params: z.strictObject({}), result: z.null() },
  // Kütüphane bölümleri (SWR: yerel DB'den anında; eskiyse arka planda senkron + onLibraryChanged).
  getLibrarySongs: { params: LibraryPageParams, result: pageOf(TrackSchema) },
  getLibraryAlbums: { params: LibraryPageParams, result: pageOf(AlbumSchema) },
  getLibraryArtists: { params: LibraryPageParams, result: pageOf(ArtistSchema) },
  /** §3.6 Arşiv → Türler: türler ve şarkı sayıları (şarkı senkronundan). */
  getLibraryGenres: { params: z.strictObject({}), result: NamedCountsSchema },
  /** §3.6 Arşiv → Besteciler: kişi kişi ayrılmış besteciler ve şarkı sayıları. */
  getLibraryComposers: { params: z.strictObject({}), result: NamedCountsSchema },
  /** §3.6: bir türün ya da bestecinin şarkıları (tam olarak biri verilir). */
  getFilteredSongs: {
    params: z.strictObject({
      genre: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(300))),
      composer: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(300))),
      offset: z.optional(intRange(0, 1_000_000)),
      limit: z.optional(intRange(1, 500)),
      sort: z.optional(z.enum(LIBRARY_SORTS))
    }),
    result: pageOf(TrackSchema)
  },
  /** §3.6 Arşiv → Derlemeler (Apple katalog `isCompilation`). */
  getLibraryCompilations: { params: LibraryPageParams, result: pageOf(AlbumSchema) },
  /** Son eklenenler (Apple sırasıyla; ağdan). */
  getRecentlyAdded: {
    params: z.strictObject({ limit: z.optional(intRange(1, 100)) }),
    result: z.array(CardSchema)
  },
  /** Albüm sayfası: katalog (sayısal id) veya kütüphane (`l.…`) albümü + şarkıları. */
  getAlbum: {
    params: z.strictObject({ id: ResourceIdSchema, locale: z.optional(LocaleSchema) }),
    result: AlbumDetailSchema
  },
  /** Sanatçı sayfası: katalog (sayısal) veya kütüphane (`r.…`; yalnızca albümler) sanatçısı. */
  getArtist: {
    params: z.strictObject({ id: ResourceIdSchema, locale: z.optional(LocaleSchema) }),
    result: ArtistDetailSchema
  },
  /** Katalog playlist'i (`pl.…`) + şarkıları; kütüphane playlist'i için getPlaylistTracks. */
  getCatalogPlaylist: {
    params: z.strictObject({ id: ResourceIdSchema, locale: z.optional(LocaleSchema) }),
    result: PlaylistDetailSchema
  },
  /** Ana Sayfa: kişisel öneri grupları; başlıklar `locale` dilinde (storefront destekliyorsa). */
  getRecommendations: {
    params: z.strictObject({ locale: z.optional(LocaleSchema) }),
    result: z.array(CardGroupSchema)
  },
  /** Ana Sayfa: son dönemde sık çalınanlar (Apple "heavy rotation"). */
  getHeavyRotation: {
    params: z.strictObject({ limit: z.optional(intRange(1, 30)) }),
    result: z.array(CardSchema)
  },
  /**
   * "Yeni" (B6): mağazanın listeleri (Popüler Parçalar / Albümler / Listeler; türsüzken Günlük Top
   * 100 ve Şehir Listeleri). `genre` verilirse yalnızca o türün listeleri. Başlıklar `locale` dilinde.
   */
  getCharts: {
    params: z.strictObject({
      limit: z.optional(intRange(1, 50)),
      locale: z.optional(LocaleSchema),
      genre: z.optional(ResourceIdSchema)
    }),
    result: z.array(CardGroupSchema)
  },
  /** Şarkı menüsü: katalog şarkısının albümü ve sanatçısı (sayfaya gitmek için). */
  getSongLinks: {
    params: z.strictObject({ id: ResourceIdSchema }),
    result: SongLinksSchema
  },
  /**
   * Bilgi paneli görselleri (§3.5): kredideki kişilerin ve sample şarkıların Apple Music karşılığı
   * (fotoğraf / kapak, tıklayınca sayfa). Sıra korunur; güvenli eşleşme yoksa `null`.
   */
  lookupInfoMedia: {
    params: z.strictObject({
      artists: z
        .array(z.string().check(z.trim(), z.minLength(1), z.maxLength(300)))
        .check(z.maxLength(40)),
      songs: z
        .array(
          z.strictObject({
            title: z.string().check(z.trim(), z.minLength(1), z.maxLength(300)),
            artist: z.string().check(z.maxLength(300))
          })
        )
        .check(z.maxLength(20))
    }),
    result: z.object({
      artists: z.array(z.nullable(ArtistSchema)),
      songs: z.array(z.nullable(TrackSchema))
    })
  },
  /** "Yeni" (B6): listelerin tür seçicisi (Apple'ın genel "Müzik" türü hariç). */
  getGenres: {
    params: z.strictObject({ locale: z.optional(LocaleSchema) }),
    result: z.array(GenreSchema)
  },
  /** Radyo: Apple Music canlı istasyonları (geniş görselli, tanıtım satırlı). */
  getLiveStations: {
    params: z.strictObject({ locale: z.optional(LocaleSchema) }),
    result: z.array(CardSchema)
  },
  /** Radyo (B6): son dinlenen istasyonlar. */
  getRecentStations: {
    params: z.strictObject({
      limit: z.optional(intRange(1, 30)),
      locale: z.optional(LocaleSchema)
    }),
    result: z.array(CardSchema)
  },
  /** Radyo (B6): istasyon türleri (Pop, Rock, Caz …). */
  getStationGenres: {
    params: z.strictObject({ locale: z.optional(LocaleSchema) }),
    result: z.array(GenreSchema)
  },
  /** Radyo (B6): bir istasyon türünün istasyonları. */
  getGenreStations: {
    params: z.strictObject({ id: ResourceIdSchema, locale: z.optional(LocaleSchema) }),
    result: z.array(CardSchema)
  },
  /** Kütüphaneye erişimi doğrular; ilk sayfadaki playlist sayısı. */
  probeLibraryAccess: {
    params: z.strictObject({}),
    result: z.number()
  },
  savePlayerState: {
    params: PlayerStateSchema,
    result: z.null()
  },
  loadPlayerState: {
    params: z.strictObject({}),
    result: z.nullable(PlayerStateSchema)
  },
  /**
   * Müzik arka planı (PLAN 3.A7), SWR: cache'te varsa anında döner (`cached`), eskiyse arka planda
   * yeniler ve değişirse `onBackgroundChanged` bildirir. Yoksa kaynaklardan toplar (kullanıcı
   * önceliğiyle) ve aşama aşama `onBackgroundProgress` bildirir (PLAN 3.A8). `lang`: sanatçı
   * özetinin dili (yoksa `en`). `complete`: sonuç tam (hiçbir bölüm `error` değil) ve cache'lendi.
   * Çalan şarkı değişip yeni şarkı istenirse eski kullanıcı istekleri `BG_CANCELLED` ile biter.
   */
  getBackground: {
    params: BackgroundRequestSchema,
    result: z.object({
      key: z.string(),
      data: TrackBackgroundSchema,
      cached: z.boolean(),
      stale: z.boolean(),
      sections: SectionsSchema,
      complete: z.boolean()
    })
  },
  /** Kuyruktaki sıradaki şarkı için düşük öncelikli ön yükleme; hemen döner. */
  prefetchBackground: {
    params: BackgroundRequestSchema,
    result: z.null()
  },
  /**
   * Şarkı sözleri (B11b, LRCLIB): ad + sanatçı + albüm + süre gönderilir. Bulunamazsa `kind: none`.
   * Yeni şarkının sözleri istenince önceki istek `BG_CANCELLED` ile biter.
   */
  getLyrics: {
    params: z.strictObject({ track: TrackRefSchema }),
    result: LyricsSchema
  },
  /** Sözleri düşük öncelikle önden yükler (süren `getLyrics`'i iptal etmez); hemen döner. */
  prefetchLyrics: {
    params: z.strictObject({ track: TrackRefSchema }),
    result: z.null()
  }
} as const satisfies Record<string, WorkerMethodDef>

export const workerEventContract = {
  /** Arka plan senkronizasyonu DB'yi değiştirdi; ilgili veri yeniden okunmalı. */
  onLibraryChanged: { event: 'library:changed', payload: LibraryScopeSchema },
  /** Arka plan senkronizasyonu başarısız (ör. çevrimdışı; yerel veri kullanılmaya devam eder). */
  onSyncError: {
    event: 'sync:error',
    payload: z.object({ target: LibraryScopeSchema, error: WireErrorSchema })
  },
  /** Arka planda yenilenen müzik arka planı değişti; `getBackground` yeniden çağrılmalı (3.A7). */
  onBackgroundChanged: {
    event: 'background:changed',
    payload: z.object({ key: z.string().check(z.maxLength(128)), lang: z.enum(SUMMARY_LANGS) })
  },
  /** `getBackground` sürerken her aşama bitince ara sonuç (yalnızca `requestId` verilen isteklere). */
  onBackgroundProgress: { event: 'background:progress', payload: BackgroundProgressSchema },
  /**
   * Kuyruktaki bir kütüphane yazması sonradan başarısız oldu (3.B2); yerel değişiklik geri alındı.
   * `op`: işlem adı (ör. `createPlaylist`) — arayüz kullanıcıya bildirir.
   */
  onLibraryWriteFailed: {
    event: 'library:writeFailed',
    payload: z.object({ op: z.string().check(z.maxLength(64)), error: WireErrorSchema })
  },
  /** Ayarlar değişti (3.B3): tüm pencereler anında uygular. */
  onSettingsChanged: { event: 'settings:changed', payload: SettingsSchema },
  /** Kalıcı katalog kaydı (Ana Sayfa, Yeni, Radyo) arka planda tazelendi: açık sayfalar yeniden okur (R2). */
  onCatalogRefreshed: { event: 'catalog:refreshed', payload: z.object({}) }
} as const

/** MessagePort üzerindeki zarf biçimleri. */
export const WorkerRequestSchema = z.object({
  id: z.number().check(z.int(), z.gte(0)),
  method: z.string(),
  // Eksikse de zarf geçerlidir; yöntemin şeması reddeder ve istek hemen yanıtlanır.
  params: z.optional(z.unknown())
})
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>
export interface WorkerResponse {
  id: number
  result: IpcResult<unknown>
}
export interface WorkerEvent {
  event: string
  payload: unknown
}

// --- Main ↔ worker (utilityProcess parentPort) ---------------------------------------------------

export const MainToWorkerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    dbPath: z.string().check(z.minLength(1)),
    /** Kapak görseli disk önbelleği klasörü (PLAN_v5 A3.2). */
    artworkDir: z.string().check(z.minLength(1))
  }),
  /** Diskte olmayan kapağı indirip önbelleğe yaz (PLAN_v5 A3.2); adres worker'da yeniden doğrulanır. */
  z.object({
    type: z.literal('fetchArtwork'),
    requestId: z.number(),
    url: z.string().check(z.maxLength(MAX_ARTWORK_URL_LENGTH))
  }),
  /** Mesajla birlikte renderer'a bağlanacak MessagePort gelir. */
  z.object({ type: z.literal('connect') }),
  z.object({ type: z.literal('userToken'), token: z.nullable(UserTokenSchema) }),
  z.object({ type: z.literal('clearUserData') }),
  /** Çökme döngüsü (PLAN 2.3): arka plan katmanı ve ön yükleme kapatılır. */
  z.object({ type: z.literal('safeMode'), enabled: z.boolean() }),
  /** Çıkışta son player durumunu kaydet (main'deki hub'dan; renderer beklenmez). */
  z.object({ type: z.literal('savePlayerState'), requestId: z.number(), state: PlayerStateSchema }),
  z.object({
    type: z.literal('developerToken'),
    requestId: z.number(),
    result: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), value: DeveloperTokenInfoSchema }),
      z.object({ ok: z.literal(false), error: WireErrorSchema })
    ])
  })
])
export type MainToWorker = z.infer<typeof MainToWorkerSchema>

export const WorkerToMainSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('fatal'), code: z.string(), message: z.string() }),
  /** `refresh`: Apple 401 verdi → main önbelleği atıp yeni token versin (PLAN_v5 A3.1). */
  z.object({
    type: z.literal('getDeveloperToken'),
    requestId: z.number(),
    refresh: z.optional(z.boolean())
  }),
  z.object({ type: z.literal('playerStateSaved'), requestId: z.number(), ok: z.boolean() }),
  z.object({
    type: z.literal('artworkFetched'),
    requestId: z.number(),
    result: z.enum(['ok', 'invalid', 'failed'])
  }),
  /** `clearUserData` onayı (2.7 O1): silme gerçekten yapıldı mı. */
  z.object({ type: z.literal('userDataCleared'), ok: z.boolean() }),
  /** İnce Ayar "Hızlı DNS" (R2): açılışta ve değişince; main Chromium DNS'ini buna göre kurar. */
  z.object({ type: z.literal('fastDns'), enabled: z.boolean() })
])
export type WorkerToMain = z.infer<typeof WorkerToMainSchema>

// --- Türetilen tipler ----------------------------------------------------------------------------

export type InvokeName = keyof typeof invokeContract
export type InvokeArgs<K extends InvokeName> = z.infer<(typeof invokeContract)[K]['args']>
export type InvokeResult<K extends InvokeName> = z.infer<(typeof invokeContract)[K]['result']>

export type EventName = keyof typeof eventContract
export type EventPayload<K extends EventName> = z.infer<(typeof eventContract)[K]['payload']>

export type WorkerMethod = keyof typeof workerContract
export type WorkerParams<K extends WorkerMethod> = z.input<(typeof workerContract)[K]['params']>
export type WorkerResult<K extends WorkerMethod> = z.infer<(typeof workerContract)[K]['result']>

export type WorkerEventName = keyof typeof workerEventContract
export type WorkerEventPayload<K extends WorkerEventName> = z.infer<
  (typeof workerEventContract)[K]['payload']
>

/** `window.api.worker`: worker'a MessagePort ile giden dar, sözleşmeli API. */
export type WorkerApi = {
  readonly [K in WorkerMethod]: (params: WorkerParams<K>) => Promise<IpcResult<WorkerResult<K>>>
} & {
  readonly [K in WorkerEventName]: (
    listener: (payload: WorkerEventPayload<K>) => void
  ) => () => void
}

/** Preload'ın `window.api` olarak expose ettiği dar API; sözleşmeden türetilir. */
export type RendererApi = {
  readonly [K in InvokeName]: (...args: InvokeArgs<K>) => Promise<IpcResult<InvokeResult<K>>>
} & {
  /** Abonelikten çıkan bir fonksiyon döner. */
  readonly [K in EventName]: (listener: (payload: EventPayload<K>) => void) => () => void
} & {
  readonly worker: WorkerApi
}

export type CdmStatus = z.infer<typeof CdmStatusSchema>
export type DeveloperTokenInfo = z.infer<typeof DeveloperTokenInfoSchema>
export type Track = z.infer<typeof TrackSchema>
export type Playlist = z.infer<typeof PlaylistSchema>
export type SearchResults = z.infer<typeof SearchResultsSchema>
export type Album = z.infer<typeof AlbumSchema>
export type Artist = z.infer<typeof ArtistSchema>
export type SearchGroups = z.infer<typeof SearchGroupsSchema>
export type UnifiedSearch = z.infer<typeof UnifiedSearchSchema>
export type SearchSuggestions = z.infer<typeof SearchSuggestionsSchema>
export type SearchScope = (typeof SEARCH_SCOPES)[number]
export type LibraryIds = z.infer<typeof LibraryIdsSchema>
export type Card = z.infer<typeof CardSchema>
export type CardGroup = z.infer<typeof CardGroupSchema>
export type Genre = z.infer<typeof GenreSchema>
export type SongLinks = z.infer<typeof SongLinksSchema>
export type AlbumDetail = z.infer<typeof AlbumDetailSchema>
export type ArtistDetail = z.infer<typeof ArtistDetailSchema>
export type PlaylistDetail = z.infer<typeof PlaylistDetailSchema>
export type LibrarySort = (typeof LIBRARY_SORTS)[number]
export type PlaylistSort = z.infer<typeof PlaylistSortSchema>
export type RatingKind = (typeof RATING_KINDS)[number]
export type RatingValue = z.infer<typeof RatingValueSchema>
export type PlayerState = z.infer<typeof PlayerStateSchema>
export type LibraryScope = z.infer<typeof LibraryScopeSchema>
export type PlayerHubState = z.infer<typeof PlayerHubStateSchema>
export type HubNowPlaying = z.infer<typeof HubNowPlayingSchema>
export type PlayerTime = z.infer<typeof PlayerTimeSchema>
export type PlayerHubSnapshot = z.infer<typeof PlayerHubSnapshotSchema>
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>

/** Kanal adı → sözleşme adı (main'de gelen kanalı çözmek için). */
export const invokeNameByChannel: ReadonlyMap<string, InvokeName> = new Map(
  (Object.keys(invokeContract) as InvokeName[]).map((name) => [invokeContract[name].channel, name])
)

export function isWorkerMethod(method: string): method is WorkerMethod {
  return Object.prototype.hasOwnProperty.call(workerContract, method)
}
