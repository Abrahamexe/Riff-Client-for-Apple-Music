import { CoreError, logError } from '@shared/errors'
import type { WorkerEvent } from '@shared/ipc-contract'
import { workerEventContract } from '@shared/ipc-contract'
import {
  MAX_SONG_PRESETS,
  migrateSettings,
  normalizeEqualizer,
  SettingsSchema,
  type Settings,
  type SettingsPatch,
  isBuiltinPresetId
} from '@shared/settings'
import type { Db } from '../db/connection'

// Ayarlar servisi (PLAN 3.B3). Tek kayıt (`settings`, anahtar `app`, JSON). Okuma: kayıtlı veri
// güvenilmez sayılır ve `migrateSettings` ile güncel sürüme/geçerli değerlere getirilir (onarılırsa
// geri yazılır). Güncelleme: bölüm bazında birleştirilir, katı şemayla doğrulanır (geçersiz →
// INVALID_ARGUMENT, hiçbir şey yazılmaz), kaydedilir ve tüm pencerelere `onSettingsChanged` gider.
// Ayarlar cihaza aittir (Apple Music gibi) ve çıkışta korunur; yalnızca dinleme alışkanlığını ele
// veren şarkıya özel EQ eşlemesi çıkışta silinir.

const KEY = 'app'

export class SettingsService {
  private cache: Settings | null = null

  constructor(
    private readonly db: Db,
    private readonly emit: (event: WorkerEvent) => void
  ) {}

  get(): Settings {
    if (this.cache) return this.cache
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
      { value: string } | undefined
    let raw: unknown = null
    if (row) {
      try {
        raw = JSON.parse(row.value)
      } catch {
        raw = 'bozuk'
      }
    }
    const { settings, repaired } = migrateSettings(raw)
    if (repaired) {
      logError(
        'settings',
        new CoreError(
          'STORE_INVALID_VALUE',
          'Ayarlar onarıldı (geçersiz alanlar varsayılana döndü).'
        )
      )
      this.write(settings)
    }
    this.cache = settings
    return settings
  }

  update(patch: SettingsPatch): Settings {
    const current = this.get()
    // Yamadaki her bölüm mevcut bölümle birleştirilir. Bölümler tek tek sayılmaz: yeni eklenen bölüm
    // (2026-10-14 ince ayar) burada unutulup değişiklikleri sessizce düşüyordu.
    const next: Record<string, unknown> = { ...current }
    for (const [name, part] of Object.entries(patch)) {
      const section = (current as Record<string, unknown>)[name]
      next[name] = { ...(section as object), ...part }
    }
    const parsed = SettingsSchema.safeParse(next)
    if (!parsed.success) {
      throw new CoreError('INVALID_ARGUMENT', 'Ayar değeri geçersiz.')
    }
    const settings = parsed.data
    const eq = settings.equalizer
    if (Object.keys(eq.songPresets).length > MAX_SONG_PRESETS) {
      throw new CoreError('INVALID_ARGUMENT', 'Şarkıya özel EQ sınırı aşıldı.')
    }
    const ids = new Set(eq.customPresets.map((p) => p.id))
    if (ids.size !== eq.customPresets.length || [...ids].some(isBuiltinPresetId)) {
      throw new CoreError('INVALID_ARGUMENT', 'Hazır ayar kimlikleri benzersiz olmalı.')
    }
    // Silinen hazır ayara işaret eden seçimler temizlenir (hata değil).
    const normalized = normalizeEqualizer(settings)
    this.write(normalized)
    this.cache = normalized
    this.emit({ event: workerEventContract.onSettingsChanged.event, payload: normalized })
    return normalized
  }

  /**
   * Çıkış: kullanıcıya özel ayarlar silinir: şarkıya özel EQ eşlemesi (dinlenen şarkıları ele verir)
   * ve profil adı. Diğer ayarlar (tema, EQ eğrisi…) kalır.
   */
  clearUserScoped(): void {
    const current = this.get()
    const hasSongPresets = Object.keys(current.equalizer.songPresets).length > 0
    const hasName = current.profile.displayName !== ''
    if (!hasSongPresets && !hasName) return
    this.update({
      ...(hasSongPresets ? { equalizer: { songPresets: {} } } : {}),
      ...(hasName ? { profile: { displayName: '' } } : {})
    })
  }

  private write(settings: Settings): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(KEY, JSON.stringify(settings))
  }
}
