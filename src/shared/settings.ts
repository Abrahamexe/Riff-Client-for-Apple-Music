import { z } from 'zod/mini'
import type { MessageKey } from './i18n/tr'

// Ayarlar (PLAN 3.B3). v1 kapsamı (geliştirici kararı): Apple Music'in (Windows) uygulama ayarlarından
// MusicKit JS'in desteklediği kadarı + EQ. Eşleme ve desteklenmeyenler: docs/SETTINGS.md.
// Şema sürümlüdür: kayıtlı veri `migrateSettings` ile güncel sürüme getirilir; bozuk/eksik bölüm
// varsayılana döner (ayarlar bozulsa da uygulama açılır). Güncellemeler katı şemayla doğrulanır.

export const SETTINGS_VERSION = 1

/** 10 oktav bandı (Hz): bastan tize işitme aralığı (kendi EQ'muz, PLAN_v5 P1; docs/SETTINGS.md). */
export const EQ_BANDS_HZ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
/** Preamp ve bant kazancı sınırı (dB, ±). */
export const EQ_MAX_DB = 12
export const FLAT_PRESET_ID = 'flat'
export const MAX_CUSTOM_PRESETS = 50
export const MAX_SONG_PRESETS = 5_000

const gainDb = z.number().check(z.gte(-EQ_MAX_DB), z.lte(EQ_MAX_DB))
const bands = z.array(gainDb).check(z.length(EQ_BANDS_HZ.length))
const presetId = z.string().check(z.regex(/^[a-z0-9-]{1,40}$/))

export const EqPresetSchema = z.strictObject({
  id: presetId,
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(60)),
  preamp: gainDb,
  bands
})

/** Arayüz dili tercihi (2026-10-19): `system` = sistem dili Türkçeyse `tr`, değilse `en` (i18n `resolveLocale`). */
export const LANGUAGE_PREFERENCES = ['system', 'tr', 'en'] as const
const GeneralSchema = z.strictObject({
  /** Apple: "Dinleme geçmişini kullan" → `music.privateEnabled = !değer`. */
  useListeningHistory: z.boolean(),
  /** Arayüz dili; Apple Music içeriği (albüm / sanatçı metinleri) de bu dilde istenir. */
  language: z.enum(LANGUAGE_PREFERENCES)
})
const PlaybackSchema = z.strictObject({
  /** Apple: Akış kalitesi. MusicKit: `bitrate` HIGH (256) / STANDARD (64). Kayıpsız yok. */
  streamingQuality: z.enum(['high', 'standard']),
  /** Apple: Otomatik çalma (Sıradaki ∞). MusicKit: `autoplayEnabled`. */
  autoplay: z.boolean()
})
const RestrictionsSchema = z.strictObject({
  /** Apple: "Müstehcen müziğe izin ver". Hesap kısıtlıysa (itre) her zaman kısıtlı. */
  allowExplicit: z.boolean()
})
const AdvancedSchema = z.strictObject({
  addSongsToLibraryOnPlaylistAdd: z.boolean(),
  addSongsToLibraryOnFavorite: z.boolean(),
  keepMiniPlayerOnTop: z.boolean(),
  /** "Bir daha gösterme" denen uyarılar; "Tüm uyarıları sıfırla" boşaltır. */
  dismissedWarnings: z.array(z.string().check(z.maxLength(64))).check(z.maxLength(100))
})
/**
 * Görünüm (PLAN_v5 B0, geliştiricinin isteği: Apple Music'te yok, kendi arayüzümüzün ayarı).
 * `transparency`: cam yüzeylerin saydamlığı, 0 = en az (neredeyse opak) … 100 = en çok.
 */
export const THEME_MODES = ['system', 'light', 'dark'] as const
/** 2026-10-14: `info` = çalan şarkının bilgisi (müzik arka planı: krediler, sample'lar, sanatçı). */
export const RIGHT_PANELS = ['none', 'lyrics', 'queue', 'info'] as const
const AppearanceSchema = z.strictObject({
  theme: z.enum(THEME_MODES),
  transparency: z.number().check(z.int(), z.gte(0), z.lte(100)),
  /** B3: sağ sütunda ne açık (Apple Music gibi sözler ve Sıradaki aynı sütunu paylaşır); hatırlanır. */
  rightPanel: z.enum(RIGHT_PANELS)
})
/**
 * İnce ayar (geliştirici isteği 2026-10-14: "uygulama meraklısı için ince ayar"). Apple Music'te
 * karşılığı yok; kendi arayüzümüzün davranışları. Her alan bir yere bağlıdır (docs/SETTINGS.md).
 */
export const MOTION_MODES = ['system', 'reduced', 'full'] as const
export const LYRICS_SIZES = ['small', 'medium', 'large'] as const
const intIn = (min: number, max: number) => z.number().check(z.int(), z.gte(min), z.lte(max))
export const TWEAK_LIMITS = {
  pulseStrength: [0, 200],
  lyricsOffsetMs: [-3000, 3000],
  volumeStep: [1, 20],
  seekStep: [1, 30],
  librarySyncMinutes: [1, 60]
} as const
const TweaksSchema = z.strictObject({
  /** Animasyonlar: Windows ayarına uy / her zaman azalt / her zaman tam. */
  motion: z.enum(MOTION_MODES),
  /** Cam bulanıklığı (zayıf GPU'da kapatılır; cam yüzeyler daha opak olur). */
  glassBlur: z.boolean(),
  /** Büyük oynatıcıda müzikle nabız şiddeti (%; 0 = kapalı). */
  pulseStrength: intIn(...TWEAK_LIMITS.pulseStrength),
  /** Senkron sözleri öne (+) / geriye (−) kaydırma (ms). */
  lyricsOffsetMs: intIn(...TWEAK_LIMITS.lyricsOffsetMs),
  lyricsSize: z.enum(LYRICS_SIZES),
  /** Ctrl+↑/↓ ses adımı (%). */
  volumeStep: intIn(...TWEAK_LIMITS.volumeStep),
  /** İlerleme çubuğunda ←/→ sarma adımı (sn). */
  seekStep: intIn(...TWEAK_LIMITS.seekStep),
  /** Ses çubuğu üzerinde fare tekerleğiyle ses. */
  wheelVolume: z.boolean(),
  /** Çalma sunucularına ön bağlantı (ilk çalma hızı; yavaş DNS'te belirgin). */
  playbackWarmup: z.boolean(),
  /** Hızlı DNS (Cloudflare 1.1.1.1; `FAST_DNS`, app-config). Yavaş sistem DNS'inde her şey hızlanır. */
  fastDns: z.boolean(),
  /** Arşiv bu kadar dakikadan eskiyse açılışta / sayfada yeniden senkronlanır. */
  librarySyncMinutes: intIn(...TWEAK_LIMITS.librarySyncMinutes),
  /** Sağ altta kare hızı göstergesi. */
  fpsMeter: z.boolean()
})

/**
 * Profil (B3 geri bildirimi): Apple adı/fotoğrafı vermediği için kullanıcı adını bir kez yazar;
 * kenar çubuğunda baş harfleri görünür. Kişisel veridir: yalnızca bu bilgisayarda, çıkışta silinir.
 */
const ProfileSchema = z.strictObject({
  displayName: z.string().check(z.trim(), z.maxLength(60))
})
const EqualizerSchema = z.strictObject({
  enabled: z.boolean(),
  preamp: gainDb,
  bands,
  /** Seçili hazır ayar (`flat` veya kendi ayarının id'si); elle oynanınca `null`. */
  presetId: z.nullable(presetId),
  customPresets: z.array(EqPresetSchema).check(z.maxLength(MAX_CUSTOM_PRESETS)),
  /** Apple: şarkıya özel hazır ayar (katalog id → hazır ayar id), genel EQ'yu geçersiz kılar. */
  songPresets: z.record(z.string().check(z.regex(/^[0-9]{1,20}$/)), presetId)
})

export const SettingsSchema = z.strictObject({
  version: z.literal(SETTINGS_VERSION),
  general: GeneralSchema,
  playback: PlaybackSchema,
  restrictions: RestrictionsSchema,
  advanced: AdvancedSchema,
  equalizer: EqualizerSchema,
  appearance: AppearanceSchema,
  profile: ProfileSchema,
  tweaks: TweaksSchema
})

/** Güncelleme: bölüm bazında kısmi; diziler/kayıtlar bütün olarak değiştirilir. */
export const SettingsPatchSchema = z.strictObject({
  general: z.optional(z.partial(GeneralSchema)),
  playback: z.optional(z.partial(PlaybackSchema)),
  restrictions: z.optional(z.partial(RestrictionsSchema)),
  advanced: z.optional(z.partial(AdvancedSchema)),
  equalizer: z.optional(z.partial(EqualizerSchema)),
  appearance: z.optional(z.partial(AppearanceSchema)),
  profile: z.optional(z.partial(ProfileSchema)),
  tweaks: z.optional(z.partial(TweaksSchema))
})

export type Settings = z.infer<typeof SettingsSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
export type EqPreset = z.infer<typeof EqPresetSchema>
export type EqualizerSettings = Settings['equalizer']
export type AppearanceSettings = Settings['appearance']
export type ThemeMode = (typeof THEME_MODES)[number]
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number]
export type RightPanel = (typeof RIGHT_PANELS)[number]
export type TweaksSettings = Settings['tweaks']
export type MotionMode = (typeof MOTION_MODES)[number]
export type LyricsSize = (typeof LYRICS_SIZES)[number]

const flatBands = (): number[] => EQ_BANDS_HZ.map(() => 0)

/** Apple Music varsayılanları. EQ kapalı (açık kararı: docs/LEGAL.md). */
export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    general: { useListeningHistory: true, language: 'system' },
    playback: { streamingQuality: 'high', autoplay: true },
    restrictions: { allowExplicit: true },
    advanced: {
      addSongsToLibraryOnPlaylistAdd: true,
      addSongsToLibraryOnFavorite: true,
      keepMiniPlayerOnTop: false,
      dismissedWarnings: []
    },
    equalizer: {
      enabled: false,
      preamp: 0,
      bands: flatBands(),
      presetId: FLAT_PRESET_ID,
      customPresets: [],
      songPresets: {}
    },
    // B1: varsayılanlar geliştiricinin onayına sunulur (referans: koyu, arkası hafif seçilen cam).
    appearance: { theme: 'system', transparency: 60, rightPanel: 'none' },
    profile: { displayName: '' },
    tweaks: {
      motion: 'system',
      glassBlur: true,
      pulseStrength: 100,
      lyricsOffsetMs: 0,
      lyricsSize: 'medium',
      volumeStep: 5,
      seekStep: 5,
      wheelVolume: false,
      playbackWarmup: true,
      fastDns: true,
      librarySyncMinutes: 5,
      fpsMeter: false
    }
  }
}

/** Uygulanacak kazançlar (dB). */
export interface EqGains {
  preamp: number
  bands: readonly number[]
}

/** Yerleşik hazır ayar: görünen adı i18n anahtarıyla (veri içinde metin yok, B-b). */
export interface BuiltinEqPreset extends EqGains {
  id: string
  nameKey: MessageKey
}

/**
 * Yerleşik hazır ayarlar (geliştirici kararı 2026-10-13, PLAN_v5 P1): KENDİ değerlerimiz; Apple'ın
 * hazır ayar adları/değerleri kullanılmaz (yayımlanmamışlardır, taklit edilmez). Bantlar
 * `EQ_BANDS_HZ` sırasıyla. Kural (testli): en yüksek bant + preamp ≤ 0 dB → güçlendirme kırpılmaz;
 * algılanan ses düzeyi azalabilir, kullanıcı preamp'ı kendisi açabilir.
 */
export const BUILTIN_EQ_PRESETS: readonly BuiltinEqPreset[] = [
  { id: FLAT_PRESET_ID, nameKey: 'settings.eq.preset.flat', preamp: 0, bands: flatBands() },
  {
    id: 'bass-boost',
    nameKey: 'settings.eq.preset.bassBoost',
    preamp: -6,
    bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]
  },
  {
    id: 'bass-cut',
    nameKey: 'settings.eq.preset.bassCut',
    preamp: 0,
    bands: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0]
  },
  {
    id: 'treble-boost',
    nameKey: 'settings.eq.preset.trebleBoost',
    preamp: -6,
    bands: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6]
  },
  {
    id: 'treble-cut',
    nameKey: 'settings.eq.preset.trebleCut',
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, -2, -4, -5, -6]
  },
  {
    id: 'vocal',
    nameKey: 'settings.eq.preset.vocal',
    preamp: -3,
    bands: [-2, -2, -1, 0, 2, 3, 3, 2, 0, -1]
  },
  {
    id: 'v-shape',
    nameKey: 'settings.eq.preset.vShape',
    preamp: -4,
    bands: [4, 3, 1, 0, -1, -2, -1, 1, 3, 4]
  },
  {
    id: 'warm',
    nameKey: 'settings.eq.preset.warm',
    preamp: -3,
    bands: [2, 3, 3, 2, 1, 0, -1, -2, -2, -3]
  },
  {
    id: 'bright',
    nameKey: 'settings.eq.preset.bright',
    preamp: -4,
    bands: [-2, -1, 0, 0, 0, 1, 2, 3, 4, 4]
  },
  {
    id: 'spoken-word',
    nameKey: 'settings.eq.preset.spokenWord',
    preamp: -3,
    bands: [-6, -4, -2, 0, 2, 3, 3, 2, 0, -2]
  }
]

export function isBuiltinPresetId(id: string): boolean {
  return BUILTIN_EQ_PRESETS.some((p) => p.id === id)
}

/** Hazır ayarın kazançları: yerleşik veya kullanıcının. Yoksa `null`. */
export function findPreset(eq: EqualizerSettings, id: string): EqGains | null {
  return (
    BUILTIN_EQ_PRESETS.find((p) => p.id === id) ?? eq.customPresets.find((p) => p.id === id) ?? null
  )
}

/** Sürüm geçişleri: `migrations[n]` n → n+1. (v1 tek sürüm; yapı ileriki sürümler için.) */
const migrations: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

const sections = [
  'general',
  'playback',
  'restrictions',
  'advanced',
  'equalizer',
  'appearance',
  'profile',
  'tweaks'
] as const
const sectionSchemas = {
  general: GeneralSchema,
  playback: PlaybackSchema,
  restrictions: RestrictionsSchema,
  advanced: AdvancedSchema,
  equalizer: EqualizerSchema,
  appearance: AppearanceSchema,
  profile: ProfileSchema,
  tweaks: TweaksSchema
}

/**
 * Kayıtlı (güvenilmez) veriyi güncel şemaya getirir. Eski sürüm göç ettirilir; bilinmeyen alanlar
 * atılır; bölüm geçersizse o bölüm varsayılana, alan eksikse alan varsayılana döner. Daha yeni bir
 * sürümün verisi (uygulama geri alınmış) varsayılanlarla değiştirilir.
 */
export function migrateSettings(raw: unknown): { settings: Settings; repaired: boolean } {
  const defaults = defaultSettings()
  if (typeof raw !== 'object' || raw === null) return { settings: defaults, repaired: raw != null }
  let data = raw as Record<string, unknown>
  let version = typeof data.version === 'number' ? data.version : 0
  if (version > SETTINGS_VERSION) return { settings: defaults, repaired: true }
  while (version < SETTINGS_VERSION) {
    const step = migrations[version]
    if (step) data = step(data)
    version++
  }
  let repaired = false
  const out: Record<string, unknown> = { version: SETTINGS_VERSION }
  for (const name of sections) {
    const merged = { ...defaults[name], ...asObject(data[name]) }
    const picked = Object.fromEntries(
      Object.keys(defaults[name]).map((k) => [k, (merged as Record<string, unknown>)[k]])
    )
    const parsed = sectionSchemas[name].safeParse(picked)
    if (parsed.success) {
      out[name] = parsed.data
      if (JSON.stringify(picked) !== JSON.stringify(data[name])) repaired = true
    } else {
      // Bölümde tek tek alanları kurtar: geçersiz alan varsayılana döner.
      const fixed: Record<string, unknown> = { ...defaults[name] }
      for (const k of Object.keys(defaults[name])) {
        const attempt = { ...fixed, [k]: (merged as Record<string, unknown>)[k] }
        if (sectionSchemas[name].safeParse(attempt).success) fixed[k] = attempt[k]
      }
      out[name] = fixed
      repaired = true
    }
  }
  const settings = SettingsSchema.parse(out)
  return { settings: normalizeEqualizer(settings), repaired }
}

/** Var olmayan hazır ayara işaret eden seçimleri temizler. */
export function normalizeEqualizer(settings: Settings): Settings {
  const eq = settings.equalizer
  const exists = (id: string): boolean => findPreset(eq, id) !== null
  const songPresets = Object.fromEntries(
    Object.entries(eq.songPresets)
      .filter(([, id]) => exists(id))
      .slice(0, MAX_SONG_PRESETS)
  )
  const presetId = eq.presetId !== null && !exists(eq.presetId) ? null : eq.presetId
  return { ...settings, equalizer: { ...eq, presetId, songPresets } }
}

const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
