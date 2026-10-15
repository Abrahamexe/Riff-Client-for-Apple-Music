import { eventContract, type EventName, type EventPayload } from '@shared/ipc-contract'
import { CoreError } from '@shared/errors'
import { isTrustedRendererUrl } from './security'

// Pencere kaydı (PLAN 1.8a, 1.8b). Uygulamanın kendi içeriğini gösteren pencereler burada kayıtlıdır:
// ana pencere (MusicKit) ve ileride mini oynatıcı gibi yardımcı pencereler. Main → renderer
// bildirimleri buradan yayınlanır; gizli/küçültülmüş pencereler sık güncellemeleri almaz ve tekrar
// görünür olunca güncel durumu (snapshot) alır. Electron'a yalnızca tip düzeyinde bağlıdır.

export type WindowRole = 'main' | 'aux'

/** Electron `BrowserWindow`'un kullandığımız yüzeyi (testte sahte pencereyle değiştirilir). */
export interface WindowLike {
  readonly id: number
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  show(): void
  restore(): void
  focus(): void
  on(event: 'closed' | 'show' | 'restore', listener: () => void): unknown
  readonly webContents: {
    send(channel: string, ...args: unknown[]): void
    getURL(): string
    readonly mainFrame: FrameIdentity
  }
}

/** Bir çerçevenin kimliği (Electron `WebFrameMain.processId` + `routingId`). */
export interface FrameIdentity {
  readonly processId: number
  readonly routingId: number
}

export interface BroadcastOptions {
  /** Gizli veya küçültülmüş pencereleri atla (sık güncellemeler, PLAN 1.8b). */
  visibleOnly?: boolean
}

export class WindowRegistry {
  private readonly windows = new Map<number, { win: WindowLike; role: WindowRole }>()
  private readonly visibleListeners = new Set<(win: WindowLike) => void>()

  constructor(private readonly isTrustedUrl: (url: string) => boolean = isTrustedRendererUrl) {}

  /** Pencereyi kaydeder; kapanınca kayıttan düşer. Tekrar görünür olunca dinleyiciler çağrılır. */
  register(win: WindowLike, role: WindowRole): void {
    if (role === 'main' && this.main())
      throw new CoreError('INTERNAL', 'Ana pencere zaten kayıtlı.')
    this.windows.set(win.id, { win, role })
    const becameVisible = (): void => {
      for (const listener of [...this.visibleListeners]) listener(win)
    }
    win.on('show', becameVisible)
    win.on('restore', becameVisible)
    win.on('closed', () => this.windows.delete(win.id))
  }

  /** Bir pencere (yeniden) görünür olduğunda; abonelikten çıkan fonksiyon döner. */
  onBecameVisible(listener: (win: WindowLike) => void): () => void {
    this.visibleListeners.add(listener)
    return () => void this.visibleListeners.delete(listener)
  }

  main(): WindowLike | null {
    for (const { win, role } of this.windows.values()) {
      if (role === 'main' && !win.isDestroyed()) return win
    }
    return null
  }

  /** Çerçeve ana pencerenin ana çerçevesi mi? (yayın kanallarını yalnızca o çağırabilir) */
  isMainWindowFrame(frame: FrameIdentity): boolean {
    const main = this.main()
    if (!main) return false
    const own = main.webContents.mainFrame
    return own.processId === frame.processId && own.routingId === frame.routingId
  }

  /** Çerçevenin ait olduğu kayıtlı pencere (yalnızca ana çerçeve; alt çerçeve / Apple girişi değil). */
  windowForFrame(frame: FrameIdentity): WindowLike | null {
    for (const { win } of this.windows.values()) {
      if (win.isDestroyed()) continue
      const own = win.webContents.mainFrame
      if (own.processId === frame.processId && own.routingId === frame.routingId) return win
    }
    return null
  }

  /** Ana pencereyi öne getirir (tray "Pencereyi göster"). */
  showMain(): boolean {
    const main = this.main()
    if (!main) return false
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    return true
  }

  /** Tek pencereye, yalnızca kendi içeriğimizi gösteriyorsa (Apple giriş sayfasına değil) gönderir. */
  send<K extends EventName>(win: WindowLike, name: K, payload: EventPayload<K>): boolean {
    if (win.isDestroyed() || !this.isTrustedUrl(win.webContents.getURL())) return false
    win.webContents.send(eventContract[name].channel, payload)
    return true
  }

  sendToMain<K extends EventName>(name: K, payload: EventPayload<K>): boolean {
    const main = this.main()
    return main ? this.send(main, name, payload) : false
  }

  broadcast<K extends EventName>(
    name: K,
    payload: EventPayload<K>,
    { visibleOnly = false }: BroadcastOptions = {}
  ): void {
    for (const { win } of [...this.windows.values()]) {
      if (visibleOnly && !isVisible(win)) continue
      this.send(win, name, payload)
    }
  }
}

function isVisible(win: WindowLike): boolean {
  return !win.isDestroyed() && win.isVisible() && !win.isMinimized()
}
