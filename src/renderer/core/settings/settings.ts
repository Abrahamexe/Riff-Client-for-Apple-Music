import type { WorkerApi } from '@shared/ipc-contract'
import type { IpcResult } from '@shared/types'
import type { Settings, SettingsPatch } from '@shared/settings'
import { fromWireError } from '../errors'
import { applyContentRestriction } from '../musickit/auth'
import type { MusicKitInstance } from '../musickit/types'

// Ayarlar (PLAN 3.B3), renderer tarafı. Kaynak worker'dır; bu istemci son değeri tutar ve değişiklik
// (bu pencereden ya da başka bir pencereden) gelince dinleyicileri çağırır. MusicKit'e uygulanan
// ayarlar `applyPlaybackSettings` ile anında etkili olur. UI'dan bağımsızdır.

/** MusicKit `PlaybackBitrate` (3.B3 gözlemi: HIGH 256, STANDARD 64). */
export const BITRATE = { high: 256, standard: 64 } as const

type SettingsApi = Pick<WorkerApi, 'getSettings' | 'updateSettings' | 'onSettingsChanged'>

export class SettingsClient {
  private value: Settings | null = null
  private readonly listeners = new Set<(s: Settings) => void>()
  private readonly off: () => void

  constructor(private readonly api: SettingsApi = window.api.worker) {
    this.off = api.onSettingsChanged((s) => this.set(s))
  }

  /** Son bilinen ayarlar (henüz yüklenmediyse `null`). */
  get current(): Settings | null {
    return this.value
  }

  async load(): Promise<Settings> {
    const s = unwrap(await this.api.getSettings({}))
    this.set(s)
    return s
  }

  /** Geçersiz değer worker'da reddedilir (INVALID_ARGUMENT); başarılıysa tüm pencerelere yayılır. */
  async update(patch: SettingsPatch): Promise<Settings> {
    const s = unwrap(await this.api.updateSettings(patch))
    this.set(s)
    return s
  }

  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  dispose(): void {
    this.off()
    this.listeners.clear()
  }

  private set(s: Settings): void {
    this.value = s
    for (const listener of [...this.listeners]) listener(s)
  }
}

/**
 * Çalma ayarlarını MusicKit'e uygular (açılışta, oturum geri yüklenince, değişince). MusicKit
 * yeniden yapılandırılınca bu değerler korunur (loader.reconfigureMusicKit).
 */
export function applyPlaybackSettings(music: MusicKitInstance, settings: Settings): void {
  music.bitrate = BITRATE[settings.playback.streamingQuality]
  music.autoplayEnabled = settings.playback.autoplay
  music.privateEnabled = !settings.general.useListeningHistory
  applyContentRestriction(settings.restrictions.allowExplicit)
}

function unwrap<T>(res: IpcResult<T>): T {
  if (res.ok) return res.value
  throw fromWireError(res.error)
}
