import type { HubPort } from '@core/player/hubPublisher'
import type { RemoteHubPort } from '@core/player/remotePlayer'
import { unwrap } from './ipc'

// Player-hub portlarının IPC (preload → main) uygulamaları (PLAN 1.8a).

/** Ana pencere (MusicKit): durumu yayınlar, komutları alır. */
export const ipcHubPort: HubPort = {
  publishState: (state) => unwrap(window.api.publishPlayerState(state)),
  publishTime: (time) => unwrap(window.api.publishPlayerTime(time)),
  onCommand: (listener) => window.api.onPlayerCommand(listener)
}

/** Herhangi bir pencere: durumu izler, komut gönderir. */
export const ipcRemoteHubPort: RemoteHubPort = {
  getState: () => unwrap(window.api.getPlayerState()),
  onState: (listener) => window.api.onPlayerState(listener),
  onTime: (listener) => window.api.onPlayerTime(listener),
  command: async (command) => void (await unwrap(window.api.sendPlayerCommand(command)))
}
