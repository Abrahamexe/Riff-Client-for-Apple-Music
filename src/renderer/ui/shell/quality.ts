import type { Settings } from '@shared/settings'
import { BITRATE } from '@core/settings/settings'

// Alt oynatıcıdaki kalite rozeti (geliştirici isteği 2026-10-15): o an hangi kalitede çalındığı.
// MusicKit JS yalnızca AAC verir (kayıpsız / Atmos yok, CHECKPOINT §11); kalite akış ayarından
// (`music.bitrate` = BITRATE[streamingQuality]) gelir.

export interface QualityInfo {
  /** Rozet metni, ör. "AAC 256". */
  badge: string
  kbps: number
  /** Ayar adının i18n anahtarı. */
  nameKey: 'settings.playback.qualityHigh' | 'settings.playback.qualityStandard'
}

export function qualityInfo(quality: Settings['playback']['streamingQuality']): QualityInfo {
  const kbps = BITRATE[quality]
  return {
    badge: `AAC ${kbps}`,
    kbps,
    nameKey:
      quality === 'high' ? 'settings.playback.qualityHigh' : 'settings.playback.qualityStandard'
  }
}
