import { describe, expect, it } from 'vitest'
import { defaultSettings, SettingsPatchSchema } from '@shared/settings'
import {
  bandLabel,
  choosePreset,
  deleteCustomPreset,
  saveCustomPreset,
  setBand,
  setPreamp
} from './eq'

const eq = () => defaultSettings().equalizer

describe('Ayarlar → Ekolayzır (B9)', () => {
  it('hazır ayar seçimi kazançları uygular; bilinmeyen id değiştirmez', () => {
    const patch = choosePreset(eq(), 'bass-boost')!
    expect(patch.equalizer).toMatchObject({ presetId: 'bass-boost', preamp: -6 })
    expect(patch.equalizer!.bands![0]).toBe(6)
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(true)
    expect(choosePreset(eq(), 'yok')).toBeNull()
  })

  it('bant / preamp elle değişince "Özel"; ±12 dB ve 0,5 dB adım', () => {
    expect(setBand(eq(), 3, 20).equalizer).toMatchObject({ presetId: null })
    expect(setBand(eq(), 3, 20).equalizer!.bands![3]).toBe(12)
    expect(setBand(eq(), 0, -3.3).equalizer!.bands![0]).toBe(-3.5)
    expect(setPreamp(-30).equalizer).toEqual({ preamp: -12, presetId: null })
  })

  it('kendi hazır ayarını kaydet / sil; yerleşik silinmez; seçiliyse Özel olur', () => {
    const base = { ...eq(), bands: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0] }
    const saved = saveCustomPreset(base, '  Benim  ', 1_700_000_000_000)!
    const presets = saved.equalizer!.customPresets!
    expect(presets[0]).toMatchObject({ name: 'Benim', bands: base.bands })
    expect(saved.equalizer!.presetId).toBe(presets[0]!.id)
    expect(SettingsPatchSchema.safeParse(saved).success).toBe(true)
    expect(saveCustomPreset(base, '   ')).toBeNull()
    const withPreset = {
      ...base,
      customPresets: presets,
      presetId: presets[0]!.id,
      songPresets: { '123': presets[0]!.id, '456': 'vocal' }
    }
    const del = deleteCustomPreset(withPreset, presets[0]!.id)!
    expect(del.equalizer).toEqual({
      customPresets: [],
      presetId: null,
      songPresets: { '456': 'vocal' }
    })
    expect(deleteCustomPreset(withPreset, 'flat')).toBeNull()
  })

  it('bant etiketleri', () => {
    expect([32, 1000, 16000].map(bandLabel)).toEqual(['32', '1K', '16K'])
  })
})
