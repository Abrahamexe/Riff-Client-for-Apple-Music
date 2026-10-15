import { describe, expect, it } from 'vitest'
import { en } from './i18n/en'
import { tr } from './i18n/tr'
import {
  BUILTIN_EQ_PRESETS,
  defaultSettings,
  EQ_BANDS_HZ,
  EQ_MAX_DB,
  EqPresetSchema,
  findPreset,
  FLAT_PRESET_ID,
  isBuiltinPresetId,
  migrateSettings,
  SettingsPatchSchema
} from './settings'

describe('yerleşik EQ hazır ayarları (PLAN_v5 P1)', () => {
  it('kimlikler benzersiz, şemaya uygun; "Düz" ilk ve sıfır', () => {
    const ids = BUILTIN_EQ_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(BUILTIN_EQ_PRESETS[0]).toMatchObject({ id: FLAT_PRESET_ID, preamp: 0 })
    expect(BUILTIN_EQ_PRESETS[0]!.bands.every((b) => b === 0)).toBe(true)
    for (const p of BUILTIN_EQ_PRESETS) {
      const { id, preamp, bands } = p
      expect(EqPresetSchema.safeParse({ id, name: 'x', preamp, bands }).success, p.id).toBe(true)
    }
  })

  it.each(BUILTIN_EQ_PRESETS.map((p) => [p.id, p] as const))(
    '%s: 10 bant, sınır içinde, kırpma payı (en yüksek bant + preamp ≤ 0 dB)',
    (_id, p) => {
      expect(p.bands).toHaveLength(EQ_BANDS_HZ.length)
      for (const v of [p.preamp, ...p.bands]) expect(Math.abs(v)).toBeLessThanOrEqual(EQ_MAX_DB)
      expect(Math.max(...p.bands) + p.preamp).toBeLessThanOrEqual(0)
    }
  )

  it('görünen adlar i18n’de (tr ve en); veri içinde metin yok', () => {
    for (const p of BUILTIN_EQ_PRESETS) {
      expect(tr[p.nameKey], p.id).toBeTruthy()
      expect(en[p.nameKey], p.id).toBeTruthy()
      expect(p).not.toHaveProperty('name')
    }
  })

  it('findPreset: yerleşik ve kullanıcının ayarı; bilinmeyen → null', () => {
    const eq = {
      ...defaultSettings().equalizer,
      customPresets: [{ id: 'benim', name: 'Benim', preamp: -1, bands: Array(10).fill(1) }]
    }
    expect(findPreset(eq, 'bass-boost')).toMatchObject({ preamp: -6 })
    expect(findPreset(eq, 'benim')).toMatchObject({ preamp: -1 })
    expect(findPreset(eq, 'yok')).toBeNull()
    expect(isBuiltinPresetId('vocal')).toBe(true)
    expect(isBuiltinPresetId('benim')).toBe(false)
  })
})

describe('ince ayar bölümü (2026-10-14)', () => {
  it('eski kayıtta bölüm yok: varsayılanlar eklenir, diğer ayarlar korunur', () => {
    const old = { ...defaultSettings(), general: { useListeningHistory: false } } as Record<
      string,
      unknown
    >
    delete old.tweaks
    const { settings } = migrateSettings(old)
    expect(settings.tweaks).toEqual(defaultSettings().tweaks)
    expect(settings.general.useListeningHistory).toBe(false)
  })

  it('sınır dışı alan tek başına varsayılana döner; yama da sınırla doğrulanır', () => {
    const raw = {
      ...defaultSettings(),
      tweaks: { ...defaultSettings().tweaks, volumeStep: 99, seekStep: 10 }
    }
    const { settings, repaired } = migrateSettings(raw)
    expect(repaired).toBe(true)
    expect(settings.tweaks.volumeStep).toBe(5)
    expect(settings.tweaks.seekStep).toBe(10)
    expect(SettingsPatchSchema.safeParse({ tweaks: { lyricsOffsetMs: 5000 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ tweaks: { lyricsOffsetMs: -250 } }).success).toBe(true)
  })
})
