import {
  eventContract,
  invokeContract,
  type EventName,
  type InvokeName,
  type RendererApi,
  type WorkerApi
} from '@shared/ipc-contract'
import { CoreError, logError } from '@shared/errors'

// Preload API'si sözleşmeden üretilir (PLAN 1.3a): her fonksiyonun kanalı SABİTTİR; renderer kanal
// adı seçemez, genel `invoke(channel, ...)`/`send`/`on` açılmaz. Electron'a bağımlı değildir (testlenebilir).

/** `ipcRenderer`'ın kullandığımız yüzeyi. */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

export function buildRendererApi(ipc: IpcRendererLike, worker: WorkerApi): RendererApi {
  const api: Record<string, unknown> = { worker }

  for (const name of Object.keys(invokeContract) as InvokeName[]) {
    const { channel } = invokeContract[name]
    api[name] = (...args: unknown[]) => ipc.invoke(channel, ...args)
  }

  for (const name of Object.keys(eventContract) as EventName[]) {
    const { channel, payload } = eventContract[name]
    api[name] = (listener: (value: unknown) => void) => {
      // `event` nesnesi renderer'a verilmez (ipcRenderer'a erişim sızdırır); yalnızca doğrulanmış yük.
      const handler = (_event: unknown, value: unknown): void => {
        const parsed = payload.safeParse(value)
        if (parsed.success) listener(parsed.data)
        else
          logError(
            'preload',
            new CoreError('INVALID_PAYLOAD', `${channel}: geçersiz bildirim yoksayıldı`)
          )
      }
      ipc.on(channel, handler)
      return () => void ipc.removeListener(channel, handler)
    }
  }

  return Object.freeze(api) as RendererApi
}

/**
 * API yalnızca kendi içeriğimizde açılır: app://renderer veya (yalnızca `allowDevLocalhost` ise)
 * dev sunucusu (http://localhost). Apple giriş penceresi gibi çocuk pencereler ayarları miras alsa
 * da API'yi görmez. Main tarafı ayrıca gönderen çerçevenin origin'ini tam olarak doğrular.
 */
export function isOwnContent(href: string, allowDevLocalhost: boolean): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol === 'app:' && url.host === 'renderer') return true
  return allowDevLocalhost && url.protocol === 'http:' && url.hostname === 'localhost'
}
