import type { StoredSession, UserTokenStore } from '@core/musickit/auth'
import { unwrap } from './ipc'

/** Apple girişi: main giriş penceresini açar; oturum şifreli kaydedilip döner (V3). */
export const ipcAuthorize = (): Promise<StoredSession> => unwrap(window.api.authorize())

/** UserTokenStore'un IPC (preload → main → safeStorage) uygulaması. Oturum yalnızca main'de şifreli saklanır. */
export const ipcUserTokenStore: UserTokenStore = {
  load: () => unwrap(window.api.loadSession()),
  clear: async () => void (await unwrap(window.api.clearUserToken()))
}
