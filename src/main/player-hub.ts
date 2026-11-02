import type {
  PlayerCommand,
  PlayerHubSnapshot,
  PlayerHubState,
  PlayerState,
  PlayerTime
} from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'
import type { WindowLike, WindowRegistry } from './windows'

// Player durum yayını (PLAN 1.8a). MusicKit yalnızca ana pencerede çalışır; ana pencere durumunu
// buraya yayınlar, hub son durumu tutar ve kayıtlı TÜM pencerelere iletir. Herhangi bir pencere
// (veya tray) `command()` ile komut gönderir; hub ana pencereye iletir. Main ağır iş yapmaz:
// yalnızca son durumu bellekte tutar ve yönlendirir.

export type HubWindows = Pick<
  WindowRegistry,
  'broadcast' | 'send' | 'sendToMain' | 'onBecameVisible'
>

const ZERO_TIME: PlayerTime = { currentTime: 0, duration: 0 }

export interface PlayerHubOptions {
  /** Widevine CDM hazır mı? (PLAN 1.8c: hazır değilken komut kabul edilmez) */
  isCdmReady?: () => boolean
}

export class PlayerHub {
  private state: PlayerHubState | null = null
  private time: PlayerTime = ZERO_TIME
  private readonly isCdmReady: () => boolean
  private readonly stateListeners = new Set<(state: PlayerHubState | null) => void>()

  constructor(
    private readonly windows: HubWindows,
    { isCdmReady = () => true }: PlayerHubOptions = {}
  ) {
    this.isCdmReady = isCdmReady
    // Tekrar görünür olan pencere, gizliyken kaçırdığı güncellemelerin yerine güncel durumu alır (1.8b).
    windows.onBecameVisible((win) => this.sendSnapshot(win))
  }

  snapshot(): PlayerHubSnapshot {
    return { state: this.state, time: this.time }
  }

  /** Ana pencereden: ayrık değişiklik (durum, şarkı, kuyruk, ayarlar). Tüm pencerelere gider. */
  publishState(state: PlayerHubState): void {
    this.state = state
    this.windows.broadcast('onPlayerState', state)
    this.notify()
  }

  /**
   * Main içindeki dinleyiciler (görev çubuğu düğmeleri): her durum yayınında ve sıfırlamada (`null`)
   * çağrılır. Döndürülen fonksiyon aboneliği kaldırır.
   */
  onState(listener: (state: PlayerHubState | null) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Ana pencereden: konum (≤ 1/sn). Yalnızca görünür pencerelere gider (PLAN 1.8b). */
  publishTime(time: PlayerTime): void {
    this.time = time
    this.windows.broadcast('onPlayerTime', time, { visibleOnly: true })
  }

  /**
   * Komutu ana pencereye iletir (PLAN 1.8c). Asla sessizce kaybolmaz:
   *  - MusicKit player'ı henüz durum yayınlamadıysa (yüklenmedi / yeniden yükleniyor) veya Widevine
   *    CDM hazır değilse PLAYER_NOT_READY;
   *  - ana pencere yoksa PLAYER_UNAVAILABLE.
   */
  command(command: PlayerCommand): void {
    if (this.state === null) {
      throw new CoreError(
        'PLAYER_NOT_READY',
        `Komut reddedildi (${command.type}): MusicKit hazır değil.`
      )
    }
    if (!this.isCdmReady()) {
      throw new CoreError(
        'PLAYER_NOT_READY',
        `Komut reddedildi (${command.type}): CDM hazır değil.`
      )
    }
    if (!this.windows.sendToMain('onPlayerCommand', command)) {
      throw new CoreError(
        'PLAYER_UNAVAILABLE',
        `Komut iletilemedi (${command.type}): ana pencere yok.`
      )
    }
  }

  /** Ana pencere yeniden yüklendi/çöktü/kapandı: eski durum artık geçerli değil. */
  reset(): void {
    this.state = null
    this.time = ZERO_TIME
    this.notify()
  }

  /** Çıkışta kaydedilecek biçim (worker player_state); kayıtlı durum yoksa `null`. */
  persistableState(): PlayerState | null {
    if (!this.state || this.state.queue.ids.length === 0) return null
    const { ids, position } = this.state.queue
    return {
      queue: ids,
      position: Math.min(position, ids.length - 1),
      currentTime: this.time.currentTime
    }
  }

  private notify(): void {
    for (const listener of this.stateListeners) listener(this.state)
  }

  private sendSnapshot(win: WindowLike): void {
    if (this.state) this.windows.send(win, 'onPlayerState', this.state)
    this.windows.send(win, 'onPlayerTime', this.time)
  }
}
