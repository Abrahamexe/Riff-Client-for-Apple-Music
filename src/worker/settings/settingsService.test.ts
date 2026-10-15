import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent } from '@shared/ipc-contract'
import { defaultSettings, migrateSettings, SETTINGS_VERSION, type Settings } from '@shared/settings'
import { openDatabase, type Db } from '../db/connection'
import { SettingsService } from './settingsService'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

const setup = () => {
  const events: WorkerEvent[] = []
  return { service: new SettingsService(db, (e) => events.push(e)), events }
}
const stored = (): unknown =>
  JSON.parse(
    (db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string }).value
  )
const store = (value: unknown) =>
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(value))

describe('migrateSettings (3.B3)', () => {
  it('kayıt yoksa Apple Music varsayılanları (Yüksek Kalite, otomatik çalma, EQ kapalı)', () => {
    const { settings, repaired } = migrateSettings(null)
    expect(repaired).toBe(false)
    expect(settings).toEqual(defaultSettings())
    expect(settings.playback).toEqual({ streamingQuality: 'high', autoplay: true })
    expect(settings.equalizer.enabled).toBe(false)
  })

  it('geçersiz alan varsayılana döner, geçerliler korunur; bilinmeyen alan atılır', () => {
    const raw = {
      version: 1,
      playback: { streamingQuality: 'lossless', autoplay: false, gizli: 1 },
      restrictions: { allowExplicit: false },
      equalizer: { ...defaultSettings().equalizer, preamp: 99, enabled: true }
    }
    const { settings, repaired } = migrateSettings(raw)
    expect(repaired).toBe(true)
    expect(settings.playback).toEqual({ streamingQuality: 'high', autoplay: false })
    expect(settings.restrictions.allowExplicit).toBe(false)
    expect(settings.equalizer).toMatchObject({ enabled: true, preamp: 0 })
  })

  it('bozuk veri ve daha yeni sürüm → varsayılanlar', () => {
    expect(migrateSettings('bozuk').settings).toEqual(defaultSettings())
    expect(migrateSettings({ version: SETTINGS_VERSION + 1 }).settings).toEqual(defaultSettings())
  })

  it('silinmiş hazır ayara işaret eden seçimler temizlenir', () => {
    const eq = {
      ...defaultSettings().equalizer,
      presetId: 'yok',
      songPresets: { '123': 'yok', '456': 'flat' }
    }
    const { settings } = migrateSettings({ ...defaultSettings(), equalizer: eq })
    expect(settings.equalizer.presetId).toBeNull()
    expect(settings.equalizer.songPresets).toEqual({ '456': 'flat' })
  })
})

describe('SettingsService (3.B3)', () => {
  it('güncelleme kalıcıdır, tüm pencerelere yayınlanır; yeni örnek aynı değeri okur', () => {
    const { service, events } = setup()
    const next = service.update({ playback: { streamingQuality: 'standard' } })
    expect(next.playback).toEqual({ streamingQuality: 'standard', autoplay: true })
    expect(events).toEqual([{ event: 'settings:changed', payload: next }])
    expect(new SettingsService(db, () => {}).get().playback.streamingQuality).toBe('standard')
  })

  it.each<[string, unknown]>([
    ['bilinmeyen değer', { playback: { streamingQuality: 'lossless' } }],
    ['aralık dışı kazanç', { equalizer: { preamp: 13 } }],
    ['eksik bant', { equalizer: { bands: [0, 0, 0] } }],
    [
      'tekrarlı hazır ayar',
      {
        equalizer: {
          customPresets: [
            { id: 'a', name: 'A', preamp: 0, bands: Array(10).fill(0) },
            { id: 'a', name: 'B', preamp: 0, bands: Array(10).fill(0) }
          ]
        }
      }
    ],
    [
      'yerleşik kimlik',
      {
        equalizer: {
          customPresets: [{ id: 'flat', name: 'X', preamp: 0, bands: Array(10).fill(0) }]
        }
      }
    ],
    [
      'yerleşik kimlik (P1 hazır ayarı)',
      {
        equalizer: {
          customPresets: [{ id: 'bass-boost', name: 'X', preamp: 0, bands: Array(10).fill(0) }]
        }
      }
    ]
  ])('geçersiz güncelleme reddedilir ve hiçbir şey yazılmaz: %s', (_l, patch) => {
    const { service, events } = setup()
    const before = service.get()
    expect(() => service.update(patch as never)).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(service.get()).toEqual(before)
    expect(events).toEqual([])
  })

  it('her bölüm güncellenebilir (yeni bölüm unutulmasın); yalnızca yamadaki alan değişir', () => {
    const { service } = setup()
    const next = service.update({ tweaks: { fpsMeter: true, lyricsOffsetMs: -300 } })
    expect(next.tweaks).toEqual({
      ...defaultSettings().tweaks,
      fpsMeter: true,
      lyricsOffsetMs: -300
    })
    expect(service.get().tweaks.fpsMeter).toBe(true)
    // Ayar şemasındaki her bölüm (version dışında) yamayla değiştirilebilir olmalı.
    const sections = Object.keys(defaultSettings()).filter((k) => k !== 'version')
    for (const name of sections) {
      const current = (service.get() as unknown as Record<string, Record<string, unknown>>)[name]!
      const updated = service.update({ [name]: { ...current } }) as unknown as Record<
        string,
        unknown
      >
      expect(updated[name]).toEqual(current)
    }
    expect(() => service.update({ tweaks: { volumeStep: 0 } })).toThrow()
  })

  it('kayıtlı bozuk ayar onarılıp geri yazılır', () => {
    store({ version: 1, general: { useListeningHistory: 'evet' } })
    const { service } = setup()
    expect(service.get().general.useListeningHistory).toBe(true)
    expect((stored() as Settings).playback.streamingQuality).toBe('high')
  })

  it('EQ: kendi hazır ayarı kaydedilir; silinince ona bağlı seçimler temizlenir', () => {
    const { service } = setup()
    const preset = { id: 'gece', name: 'Gece', preamp: -3, bands: [3, 2, 1, 0, 0, 0, 0, 1, 2, 3] }
    service.update({
      equalizer: {
        enabled: true,
        customPresets: [preset],
        presetId: 'gece',
        songPresets: { '1440806041': 'gece' }
      }
    })
    expect(service.get().equalizer).toMatchObject({
      presetId: 'gece',
      songPresets: { '1440806041': 'gece' }
    })
    const after = service.update({ equalizer: { customPresets: [] } })
    expect(after.equalizer.presetId).toBeNull()
    expect(after.equalizer.songPresets).toEqual({})
  })

  it('çıkış: şarkıya özel EQ eşlemesi ve profil adı silinir, diğer ayarlar kalır', () => {
    const { service } = setup()
    service.update({
      playback: { autoplay: false },
      equalizer: { songPresets: { '1440806041': 'flat' } },
      profile: { displayName: 'İbrahim Hakkı' },
      appearance: { theme: 'dark' }
    })
    service.clearUserScoped()
    const s = service.get()
    expect(s.equalizer.songPresets).toEqual({})
    expect(s.profile.displayName).toBe('')
    expect(s.playback.autoplay).toBe(false)
    expect(s.appearance.theme).toBe('dark')
  })

  it('profil adı 60 karakterle sınırlı; boşluklar kırpılır', () => {
    const { service } = setup()
    expect(service.update({ profile: { displayName: '  Ada  ' } }).profile.displayName).toBe('Ada')
    expect(() => service.update({ profile: { displayName: 'x'.repeat(61) } })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })
})
