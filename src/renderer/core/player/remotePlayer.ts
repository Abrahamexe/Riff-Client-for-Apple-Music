import type {
  PlayerCommand,
  PlayerHubSnapshot,
  PlayerHubState,
  PlayerTime
} from '@shared/ipc-contract'
import { TypedEmitter } from '../emitter'

// Herhangi bir pencerenin (mini oynatıcı, ileride ana UI) player'ı uzaktan izlediği ve yönettiği
// istemci (PLAN 1.8a). MusicKit'e dokunmaz: durum main'deki hub'dan gelir, komutlar hub'a gider.
// Pencere açılınca önce bildirimlere abone olur, sonra snapshot'ı alır (araya giren güncelleme
// eski snapshot tarafından ezilmez).

/** Hub erişimi (uygulamada preload → IPC; renderer/playerHub.ts). */
export interface RemoteHubPort {
  getState(): Promise<PlayerHubSnapshot>
  onState(listener: (state: PlayerHubState) => void): () => void
  onTime(listener: (time: PlayerTime) => void): () => void
  command(command: PlayerCommand): Promise<void>
}

export class RemotePlayer extends TypedEmitter<{ state: PlayerHubState; time: PlayerTime }> {
  private currentState: PlayerHubState | null = null
  private currentTime: PlayerTime = { currentTime: 0, duration: 0 }
  private offs: (() => void)[] = []
  private pushedState = false
  private pushedTime = false

  constructor(private readonly port: RemoteHubPort) {
    super()
  }

  get state(): PlayerHubState | null {
    return this.currentState
  }

  get time(): PlayerTime {
    return this.currentTime
  }

  async start(): Promise<void> {
    if (this.offs.length === 0) {
      this.offs = [
        this.port.onState((state) => {
          this.pushedState = true
          this.setState(state)
        }),
        this.port.onTime((time) => {
          this.pushedTime = true
          this.setTime(time)
        })
      ]
    }
    const snapshot = await this.port.getState()
    if (!this.pushedState && snapshot.state) this.setState(snapshot.state)
    if (!this.pushedTime) this.setTime(snapshot.time)
  }

  stop(): void {
    for (const off of this.offs) off()
    this.offs = []
  }

  command(command: PlayerCommand): Promise<void> {
    return this.port.command(command)
  }

  private setState(state: PlayerHubState): void {
    this.currentState = state
    this.emit('state', state)
  }

  private setTime(time: PlayerTime): void {
    this.currentTime = time
    this.emit('time', time)
  }
}
