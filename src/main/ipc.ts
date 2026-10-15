import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { decodeJwt } from 'jose'
import {
  invokeContract,
  invokeNameByChannel,
  type AuthSession,
  type DeveloperTokenInfo,
  type InvokeArgs,
  type InvokeName,
  type InvokeResult,
  type WindowAction,
  type WindowState
} from '@shared/ipc-contract'
import { CoreError, logError } from '@shared/errors'
import type { IpcErrorCode, IpcResult } from '@shared/types'
import type { CdmStatusTracker } from './cdm'
import type { PlayerHub } from './player-hub'
import { isTrustedRendererUrl } from './security'
import { decodeSession, encodeSession } from './storage/authSession'
import type { SecureStore } from './storage/secureStore'
import type { TokenProvider } from './token/TokenProvider'
import { externalLinkUrl, sourceLinkUrl } from './externalLinks'
import type { FrameIdentity } from './windows'
import type { FrameLike } from './worker-host'

/** Main'in worker'la ilgili, IPC'den tetiklenen işlemleri (WorkerHost). */
export interface WorkerBridge {
  connect(frame: FrameLike): Promise<void>
  setUserToken(token: string | null): void
  /** Onaylı silme (2.7 O1); başarısızsa hata fırlatır. */
  clearUserData(): Promise<void>
}

/** Pencere işlemleri (WindowRegistry + index.ts). */
export interface WindowBridge {
  /** Çerçeve ana pencerenin (MusicKit) ana çerçevesi mi? */
  isMainWindowFrame(frame: FrameIdentity): boolean
  /** B12b: MiniPlayer'ı açar (varsa öne getirir) ve ana pencereyi gizler. */
  openMiniPlayer(options: { alwaysOnTop: boolean }): void
  /** B12b: çerçeve MiniPlayer'ınsa onu kapatır, ana pencereyi gösterir; değilse `false`. */
  closeMiniPlayer(frame: FrameIdentity): boolean
  /** B1: çağıran çerçevenin penceresine pencere eylemi; kayıtlı penceremiz değilse `false`. */
  controlWindow(frame: FrameIdentity, action: WindowAction): boolean
  /** B1: çağıran çerçevenin pencere durumu; kayıtlı değilse `null`. */
  windowState(frame: FrameIdentity): WindowState | null
}

/** Apple giriş akışı (apple-authorizer.ts). */
export interface Authorizer {
  authorize(): Promise<AuthSession>
}

export interface IpcDependencies {
  tokenProvider: TokenProvider
  authorizer: Authorizer
  /**
   * Çıkışta silinen yerel dosyalar (PLAN 2.5): kapak önbelleği, log dosyası, çökme dökümleri.
   * Token ve DB ayrıca silinir (userTokenStore, worker).
   */
  localFiles?: { clear(): Promise<void> }
  /** Tanılama paketi (2.3): İndirilenler'e yazar, dosya adını döner. */
  diagnostics?: { export(): Promise<{ fileName: string }> }
  /** Kapak görseli disk önbelleği (2.2). */
  artworkCache?: { clear(): Promise<void> }
  /** Varsayılan tarayıcıda açar (`shell.openExternal`); adres `externalLinkUrl` ile doğrulanmıştır. */
  openExternal?: (url: string) => Promise<void>
  /** Panoya yazar (`clipboard.writeText`); metin sözleşmede Apple Music bağlantısı olarak doğrulanır. */
  writeClipboard?: (text: string) => Promise<void>
  /** Çalma sunucularına ön bağlantı (`playbackWarmup.ts`; sıklık sınırı orada). */
  warmupPlayback?: () => void
  /** Music User Token'ın şifreli saklandığı depo (userData/auth.bin). */
  userTokenStore: SecureStore
  cdm: CdmStatusTracker
  worker: WorkerBridge
  hub: Pick<PlayerHub, 'publishState' | 'publishTime' | 'snapshot' | 'command' | 'reset'>
  windows: WindowBridge
}

/** Çağrıyı yapan çerçevenin, doğrulama için gereken yüzeyi (Electron `WebFrameMain`). */
export interface SenderFrame extends FrameLike, FrameIdentity {
  readonly url: string
  readonly parent: unknown
}

export type IpcHandlers = {
  [K in InvokeName]: (args: InvokeArgs<K>, frame: SenderFrame) => Promise<InvokeResult<K>>
}

export type IpcDispatcher = (
  channel: string,
  event: { senderFrame: SenderFrame | null | undefined },
  args: unknown[]
) => Promise<IpcResult<unknown>>

/** Reddi katalog koduyla loglar (değer değil, yalnızca kanal ve neden) ve renderer'a döner. */
function reject(code: IpcErrorCode, logMessage: string): IpcResult<never> {
  logError('ipc', new CoreError(code, logMessage))
  return { ok: false, error: { code, message: 'İstek reddedildi.' } }
}

/**
 * Her çağrı sırayla: (1) kanal sözleşmede mi, (2) gönderen güvenilir renderer'ın ana çerçevesi mi,
 * (3) argümanlar zod şemasına uyuyor mu — kontrol edilir; herhangi biri başarısızsa handler
 * ÇAĞRILMAZ. Hatalar IpcResult'a çevrilir; bilinmeyen hatanın ayrıntısı renderer'a sızdırılmaz.
 * Loglara argüman DEĞERLERİ yazılmaz (token içerebilir), yalnızca kanal ve şema hatasının yolu/kodu.
 */
/** IPC hız sınırı (PLAN 2.4): kanal başına jeton kovası. Normal kullanım (≤ 1/sn konum) çok altında. */
export interface RateLimit {
  burst: number
  perSecond: number
}
const DEFAULT_IPC_RATE_LIMIT: RateLimit = { burst: 200, perSecond: 100 }
/** Main'de ağır iş yapan kanallar (2.7 D6): tanılama paketi sıkıştırma + log tarama. */
const CHANNEL_RATE_LIMITS: Readonly<Record<string, RateLimit>> = {
  [invokeContract.exportDiagnostics.channel]: { burst: 1, perSecond: 0.2 },
  [invokeContract.clearArtworkCache.channel]: { burst: 2, perSecond: 0.5 },
  // P4: tarayıcı sekmesi açar; art arda tıklama sekme yağmuru olmasın.
  [invokeContract.openExternalLink.channel]: { burst: 2, perSecond: 0.5 },
  [invokeContract.copyAppleMusicLink.channel]: { burst: 4, perSecond: 2 }
}

function createRateLimiter(fallback: RateLimit, now: () => number) {
  const buckets = new Map<string, { tokens: number; at: number; lastLog: number }>()
  return (channel: string): { allowed: boolean; log: boolean } => {
    const limit = CHANNEL_RATE_LIMITS[channel] ?? fallback
    const t = now()
    const b = buckets.get(channel) ?? { tokens: limit.burst, at: t, lastLog: -Infinity }
    b.tokens = Math.min(limit.burst, b.tokens + ((t - b.at) / 1000) * limit.perSecond)
    b.at = t
    buckets.set(channel, b)
    if (b.tokens >= 1) {
      b.tokens -= 1
      return { allowed: true, log: false }
    }
    const log = t - b.lastLog >= 1000
    if (log) b.lastLog = t
    return { allowed: false, log }
  }
}

export function createIpcDispatcher(
  handlers: IpcHandlers,
  isTrustedUrl: (url: string | undefined) => boolean = isTrustedRendererUrl,
  {
    rateLimit = DEFAULT_IPC_RATE_LIMIT,
    now = Date.now
  }: { rateLimit?: RateLimit; now?: () => number } = {}
): IpcDispatcher {
  const limiter = createRateLimiter(rateLimit, now)
  return async (channel, event, args) => {
    const name = invokeNameByChannel.get(channel)
    if (!name) {
      return reject(
        'UNKNOWN_CHANNEL',
        `bilinmeyen kanal reddedildi: ${JSON.stringify(channel).slice(0, 80)}`
      )
    }
    const rate = limiter(channel)
    if (!rate.allowed) {
      if (rate.log)
        logError('ipc', new CoreError('IPC_RATE_LIMITED', `${channel}: hız sınırı aşıldı`))
      return { ok: false, error: { code: 'IPC_RATE_LIMITED', message: 'İstek reddedildi.' } }
    }

    const frame = event.senderFrame
    // Yalnızca kendi içeriğimizin ANA çerçevesi (iframe değil) çağırabilir.
    if (!frame || frame.parent !== null || !isTrustedUrl(frame.url)) {
      return reject('FORBIDDEN', `${channel}: güvenilmeyen gönderen reddedildi`)
    }

    const parsed = invokeContract[name].args.safeParse(args)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}:${i.code}`)
      return reject('INVALID_PAYLOAD', `${channel}: geçersiz yük reddedildi (${issues.join(', ')})`)
    }

    try {
      const handler = handlers[name] as (a: unknown, f: SenderFrame) => Promise<unknown>
      return { ok: true, value: await handler(parsed.data, frame) }
    } catch (err) {
      // Katalog hataları (TokenError, SecureStoreError dahil) kod + teknik mesaj + parametreyle
      // iletilir; mesajlar token/key/yol içermez. Beklenmeyen hatanın ayrıntısı yalnızca logda.
      if (err instanceof CoreError) return { ok: false, error: err.toWire() }
      logError('ipc', err, 'INTERNAL', `${channel} beklenmeyen hata`)
      return { ok: false, error: { code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu.' } }
    }
  }
}

export function createIpcHandlers({
  tokenProvider,
  authorizer,
  localFiles,
  diagnostics,
  artworkCache,
  openExternal,
  writeClipboard,
  warmupPlayback,
  userTokenStore,
  cdm,
  worker,
  hub,
  windows
}: IpcDependencies): IpcHandlers {
  /** Player yayını ve Apple girişi yalnızca MusicKit'in çalıştığı ana pencereden (PLAN 1.8a, V3). */
  const requireMainWindow = (frame: SenderFrame, channel: string): void => {
    if (!windows.isMainWindowFrame(frame)) {
      throw new CoreError('FORBIDDEN', `${channel}: yalnızca ana pencere çağırabilir.`)
    }
  }

  return {
    getDeveloperToken: () => developerTokenInfo(tokenProvider),
    loadSession: async () => decodeSession(await userTokenStore.load()),
    authorize: async (_args, frame) => {
      requireMainWindow(frame, 'auth:authorize')
      const session = await authorizer.authorize()
      await userTokenStore.save(encodeSession(session))
      worker.setUserToken(session.token)
      return session
    },
    // Çıkış veya 401: token ile birlikte yerel kullanıcı verisi (DB) de silinir (PLAN 1.5).
    // 2.7: token önce worker'dan alınır (sonraki kayıtlar yoksayılır), hub'daki son durum bırakılır
    // (kapanış flush'ı geri yazmasın); silme adımları birbirini engellemez, hatalar toplu bildirilir.
    clearUserToken: async () => {
      worker.setUserToken(null)
      hub.reset()
      const results = await Promise.allSettled([
        worker.clearUserData(),
        userTokenStore.clear(),
        localFiles?.clear() ?? Promise.resolve()
      ])
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      for (const f of failed) logError('privacy', f.reason, 'INTERNAL', 'Çıkış silmesi başarısız.')
      if (failed[0]) throw failed[0].reason
      return null
    },
    getCdmStatus: () => Promise.resolve(cdm.current()),
    connectWorker: async (_args, frame) => {
      await worker.connect(frame)
      return null
    },
    publishPlayerState: ([state], frame) => {
      requireMainWindow(frame, 'player:publishState')
      hub.publishState(state)
      return Promise.resolve(null)
    },
    publishPlayerTime: ([time], frame) => {
      requireMainWindow(frame, 'player:publishTime')
      hub.publishTime(time)
      return Promise.resolve(null)
    },
    getPlayerState: () => Promise.resolve(hub.snapshot()),
    sendPlayerCommand: ([command]) => {
      hub.command(command)
      return Promise.resolve(null)
    },
    exportDiagnostics: async (_args, frame) => {
      requireMainWindow(frame, 'diagnostics:export')
      if (!diagnostics) throw new CoreError('INTERNAL', 'Tanılama paketi kullanılamıyor.')
      return diagnostics.export()
    },
    clearArtworkCache: async (_args, frame) => {
      requireMainWindow(frame, 'cache:clearArtwork')
      await artworkCache?.clear()
      return null
    },
    openExternalLink: async ([link], frame) => {
      requireMainWindow(frame, 'shell:openExternalLink')
      if (!openExternal) throw new CoreError('INTERNAL', 'Dış bağlantı açılamıyor.')
      await openExternal(externalLinkUrl(link))
      return null
    },
    openSourceLink: async ([url], frame) => {
      requireMainWindow(frame, 'shell:openSourceLink')
      if (!openExternal) throw new CoreError('INTERNAL', 'Dış bağlantı açılamıyor.')
      await openExternal(sourceLinkUrl(url))
      return null
    },
    copyAppleMusicLink: async ([url], frame) => {
      requireMainWindow(frame, 'clipboard:copyAppleMusicLink')
      if (!writeClipboard) throw new CoreError('INTERNAL', 'Pano kullanılamıyor.')
      await writeClipboard(url)
      return null
    },
    warmupPlayback: (_args, frame) => {
      requireMainWindow(frame, 'net:warmupPlayback')
      warmupPlayback?.()
      return Promise.resolve(null)
    },
    windowControl: ([action], frame) => {
      if (!windows.controlWindow(frame, action)) {
        throw new CoreError('FORBIDDEN', 'window:control: kayıtlı pencere değil.')
      }
      return Promise.resolve(null)
    },
    getWindowState: (_args, frame) => {
      const state = windows.windowState(frame)
      if (!state) throw new CoreError('FORBIDDEN', 'window:getState: kayıtlı pencere değil.')
      return Promise.resolve(state)
    },
    openMiniPlayer: ([options], frame) => {
      requireMainWindow(frame, 'window:openMini')
      windows.openMiniPlayer(options)
      return Promise.resolve(null)
    },
    closeMiniPlayer: (_args, frame) => {
      if (!windows.closeMiniPlayer(frame)) {
        throw new CoreError('FORBIDDEN', 'window:closeMini: yalnızca MiniPlayer çağırabilir.')
      }
      return Promise.resolve(null)
    }
  }
}

export async function developerTokenInfo(provider: TokenProvider): Promise<DeveloperTokenInfo> {
  const token = await provider.getDeveloperToken()
  return { token, expiresAt: decodeJwt(token).exp ?? 0 }
}

/** Yalnızca sözleşmedeki kanallar kaydedilir; diğer kanallara handler olmadığı için Electron reddeder. */
export function registerIpcHandlers(ipcMain: Pick<IpcMain, 'handle'>, handlers: IpcHandlers): void {
  const dispatch = createIpcDispatcher(handlers)
  for (const name of Object.keys(invokeContract) as InvokeName[]) {
    const { channel } = invokeContract[name]
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) =>
      dispatch(channel, event, args)
    )
  }
}
