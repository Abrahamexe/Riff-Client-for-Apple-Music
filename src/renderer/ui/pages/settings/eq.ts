import {
  EQ_MAX_DB,
  MAX_CUSTOM_PRESETS,
  findPreset,
  isBuiltinPresetId,
  type EqualizerSettings,
  type SettingsPatch
} from '@shared/settings'

// Ayarlar → Ekolayzır (B9): ayar yamaları üreten saf yardımcılar (testli). Ses zinciri ayarlardan
// beslenir (core/audio/equalizer.ts); arayüz yalnızca ayarı değiştirir.

const clampDb = (v: number): number =>
  Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, Math.round(v * 2) / 2))

/** Hazır ayar seçildi: kazançları uygulanır. Bilinmeyen id → değişiklik yok. */
export function choosePreset(eq: EqualizerSettings, id: string): SettingsPatch | null {
  const preset = findPreset(eq, id)
  if (!preset) return null
  return { equalizer: { presetId: id, preamp: preset.preamp, bands: [...preset.bands] } }
}

/** Bir bant elle değişti: hazır ayar "Özel"e (null) döner. Değer ±12 dB, 0,5 dB adım. */
export function setBand(eq: EqualizerSettings, index: number, db: number): SettingsPatch {
  const bands = eq.bands.map((v, i) => (i === index ? clampDb(db) : v))
  return { equalizer: { bands, presetId: null } }
}

export function setPreamp(db: number): SettingsPatch {
  return { equalizer: { preamp: clampDb(db), presetId: null } }
}

/** Şu anki eğriyi adıyla kendi hazır ayarı olarak kaydeder ve seçer. Ad boşsa / sınır doluysa `null`. */
export function saveCustomPreset(
  eq: EqualizerSettings,
  name: string,
  now: number = Date.now()
): SettingsPatch | null {
  const trimmed = name.trim().slice(0, 60)
  if (trimmed === '' || eq.customPresets.length >= MAX_CUSTOM_PRESETS) return null
  let id = `custom-${now.toString(36)}`
  while (isBuiltinPresetId(id) || eq.customPresets.some((p) => p.id === id)) id += 'x'
  const preset = { id, name: trimmed, preamp: eq.preamp, bands: [...eq.bands] }
  return { equalizer: { customPresets: [...eq.customPresets, preset], presetId: id } }
}

/** Kendi hazır ayarını siler (yerleşikler silinmez); seçiliyse eğri kalır, seçim "Özel"e döner. */
export function deleteCustomPreset(eq: EqualizerSettings, id: string): SettingsPatch | null {
  if (isBuiltinPresetId(id) || !eq.customPresets.some((p) => p.id === id)) return null
  return {
    equalizer: {
      customPresets: eq.customPresets.filter((p) => p.id !== id),
      presetId: eq.presetId === id ? null : eq.presetId,
      songPresets: Object.fromEntries(Object.entries(eq.songPresets).filter(([, p]) => p !== id))
    }
  }
}

/** Bant etiketi: 32, 64 … 1K, 2K … 16K. */
export const bandLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}K` : String(hz))
