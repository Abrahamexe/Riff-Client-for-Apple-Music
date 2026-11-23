import type { MessagePortMain } from 'electron'
import {
  WORKER_PORT_CHANNEL,
  WorkerToMainSchema,
  type DeveloperTokenInfo,
  type MainToWorker,
  type PlayerState
} from '@shared/ipc-contract'
import { CoreError, fromWireError, logError } from '@shared/errors'
import type { IpcResult } from '@shared/types'
import type { ArtworkFetchResult } from '@shared/artwork'

// Worker sürecinin (utilityProcess) main tarafı (PLAN 1.7a). Main ağır iş yapmaz: yalnızca worker'ı
// başlatır, developer token isteklerini yanıtlar ve doğrulanmış renderer çerçevesine worker'a
// bağlı bir MessagePort verir. Beklenmedik çıkışta `onUnexpectedExit` çağrılır; supervisor (PLAN 2.3)
// `restart()` ile yeniden başlatır ve daha önce bağlanmış pencerelere yeni port verilir.

/** Electron `UtilityProcess`'in kullandığımız yüzeyi. */
export interface ChildLike {
  postMessage(message: MainToWorker, transfer?: MessagePortMain[]): void
  on(event: 'spawn', listener: () => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  on(event: 'message', listener: (message: unknown) => void): unknown
  kill(): boolean
}

export interface FrameLike {
  postMessage(channel: string, message: unknown, transfer?: MessagePortMain[]): void
}

export interface WorkerHostOptions {
  dbPath: string
  /** Kapak görseli disk önbelleği klasörü; worker indirip yazar (PLAN_v5 A3.2). */
  artworkDir: string
  /** Kapak indirme isteğinin en uzun süresi; aşılırsa `failed`. */
  artworkTimeoutMs?: number
  fork: () => ChildLike
  createChannel: () => { port1: MessagePortMain; port2: MessagePortMain }
  /** `refresh`: önbelleği atıp yeni token (Apple 401; PLAN_v5 A3.1). */
  getDeveloperToken: (refresh: boolean) => Promise<IpcResult<DeveloperTokenInfo>>
  /**
   * Worker'ın zorla yenileme isteklerinin en sık aralığı: Apple her isteğe 401 verirse (anahtar iptal)
   * her istek token servisine gitmesin; aralık içindeki istek önbellekteki token'ı alır.
   */
  tokenRefreshCooldownMs?: number
  now?: () => number
  /** Worker'ın `ready` bildirmesi için en fazla beklenecek süre. */
  readyTimeoutMs?: number
  /** Kasıtlı durdurma dışındaki çıkış (çökme): supervisor karar verir (PLAN 2.3). */
  onUnexpectedExit?: (code: number) => void
  /**
   * Worker çalışmıyorken (çökmüş, yeniden başlatma beklemesinde) çıkış silmesi: DB dosyaları kapalı
   * olduğundan main siler; worker yeniden başlayınca boş DB kurar (2.7 O1).
   */
  removeDatabaseFiles?: () => Promise<void>
  /** İnce Ayar "Hızlı DNS" değeri (worker açılışta ve ayar değişince bildirir; R2). */
  onFastDns?: (enabled: boolean) => void
  /** Worker'ın silmeyi onaylaması için en fazla beklenecek süre. */
  clearTimeoutMs?: number
}

const unavailable = (): CoreError =>
  new CoreError('WORKER_UNAVAILABLE', 'Yerel veri servisi başlatılamadı.')

export class WorkerHost {
  private child: ChildLike | null = null
  private userToken: string | null = null
  private ready: Promise<ChildLike> | null = null
  private nextRequestId = 1
  /** Kasıtlı durdurma (çıkış): süreç sonu hata sayılmaz. */
  private stopping = false
  private readonly saveRequests = new Map<number, () => void>()
  private readonly artworkRequests = new Map<
    number,
    (result: ArtworkFetchResult | 'unavailable') => void
  >()
  private readonly clearWaiters = new Set<(ok: boolean) => void>()
  /** Port verilmiş çerçeveler: worker yeniden başlayınca yeni port alırlar. */
  private readonly frames = new Set<FrameLike>()
  private safeMode = false
  private lastForcedRefresh = Number.NEGATIVE_INFINITY

  constructor(private readonly options: WorkerHostOptions) {}

  start(): void {
    if (this.child) return
    const child = this.options.fork()
    this.child = child
    let settle!: { resolve: (c: ChildLike) => void; reject: (e: CoreError) => void }
    this.ready = new Promise<ChildLike>((resolve, reject) => (settle = { resolve, reject }))
    // Bekleyen yoksa işlenmemiş reddetme uyarısı çıkmasın.
    this.ready.catch(() => {})
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      settle.reject(unavailable())
    }, this.options.readyTimeoutMs ?? 15_000)

    child.on('spawn', () => {
      child.postMessage({
        type: 'init',
        dbPath: this.options.dbPath,
        artworkDir: this.options.artworkDir
      })
      child.postMessage({ type: 'userToken', token: this.userToken })
      if (this.safeMode) child.postMessage({ type: 'safeMode', enabled: true })
    })
    child.on('exit', (code) => {
      if (this.stopping) console.info(`[worker] durduruldu (kod ${code})`)
      else logError('worker', new CoreError('WORKER_UNAVAILABLE', `süreç sonlandı (kod ${code})`))
      clearTimeout(timer)
      settle.reject(unavailable())
      // Bekleyen kayıt istekleri yanıt alamayacak: çıkış takılmasın.
      for (const done of this.saveRequests.values()) done()
      this.saveRequests.clear()
      for (const done of [...this.artworkRequests.values()]) done('unavailable')
      for (const done of [...this.clearWaiters]) done(false)
      if (this.child === child) {
        this.child = null
        this.ready = Promise.reject(unavailable())
        this.ready.catch(() => {})
        if (!this.stopping) this.options.onUnexpectedExit?.(code)
      }
    })
    child.on('message', (raw) => {
      const parsed = WorkerToMainSchema.safeParse(raw)
      if (!parsed.success) {
        logError('worker', new CoreError('INVALID_PAYLOAD', 'geçersiz worker mesajı yoksayıldı'))
        return
      }
      const msg = parsed.data
      switch (msg.type) {
        case 'ready':
          clearTimeout(timer)
          settle.resolve(child)
          // 2.7 O2: geç gelen hazır bildirimi (büyük DB'de ilk açılış) yoksayılmaz: bekleyen
          // pencereler port alır, sonraki connect'ler çalışır.
          if (timedOut && this.child === child) {
            this.ready = Promise.resolve(child)
            for (const frame of [...this.frames]) this.givePort(child, frame)
          }
          break
        case 'fatal':
          logError('worker', fromWireError(msg))
          clearTimeout(timer)
          settle.reject(unavailable())
          break
        case 'userDataCleared':
          for (const done of [...this.clearWaiters]) done(msg.ok)
          break
        case 'fastDns':
          this.options.onFastDns?.(msg.enabled)
          break
        case 'artworkFetched':
          this.artworkRequests.get(msg.requestId)?.(msg.result)
          break
        case 'playerStateSaved': {
          const done = this.saveRequests.get(msg.requestId)
          this.saveRequests.delete(msg.requestId)
          done?.()
          break
        }
        case 'getDeveloperToken':
          void this.options
            .getDeveloperToken(msg.refresh === true && this.allowForcedRefresh())
            .then((result) =>
              child.postMessage({ type: 'developerToken', requestId: msg.requestId, result })
            )
          break
      }
    })
  }

  private allowForcedRefresh(): boolean {
    const now = (this.options.now ?? Date.now)()
    if (now - this.lastForcedRefresh < (this.options.tokenRefreshCooldownMs ?? 60_000)) return false
    this.lastForcedRefresh = now
    return true
  }

  /** Çerçeveye (yalnızca main'in doğruladığı renderer) worker'a bağlı yeni bir port verir. */
  async connect(frame: FrameLike): Promise<void> {
    if (!this.ready) throw unavailable()
    // 2.7 O2: çerçeve beklemeden ÖNCE kaydedilir; worker şu an hazır değilse (yeniden başlatma
    // beklemesi, geç açılış) hazır olunca port yine verilir.
    this.frames.add(frame)
    const child = await this.ready
    this.givePort(child, frame)
  }

  /** Çökmüş worker'ı yeniden başlatır; hazır olunca bağlı pencereler yeni port alır (PLAN 2.3). */
  restart(): void {
    if (this.child) return
    this.stopping = false
    this.start()
    const ready = this.ready
    ready
      ?.then((child) => {
        for (const frame of [...this.frames]) this.givePort(child, frame)
      })
      .catch(() => {
        /* yeniden başlatma da başarısız: exit olayı supervisor'a bildirildi */
      })
  }

  /** Güvenli mod (PLAN 2.3): worker'a bildirilir; yeniden başlatmalarda da korunur. */
  setSafeMode(enabled: boolean): void {
    this.safeMode = enabled
    this.child?.postMessage({ type: 'safeMode', enabled })
  }

  private givePort(child: ChildLike, frame: FrameLike): void {
    const { port1, port2 } = this.options.createChannel()
    try {
      frame.postMessage(WORKER_PORT_CHANNEL, null, [port2])
    } catch {
      // Çerçeve kapanmış (pencere kapatıldı / yeniden yüklendi): artık port almaz.
      this.frames.delete(frame)
      port1.close()
      return
    }
    child.postMessage({ type: 'connect' }, [port1])
  }

  setUserToken(token: string | null): void {
    this.userToken = token
    this.child?.postMessage({ type: 'userToken', token })
  }

  /**
   * Son player durumunu kaydettirir (çıkış öncesi, PLAN 1.8a). Worker yoksa hemen döner; zaman
   * aşımını çağıran (AppLifecycle) uygular.
   */
  savePlayerState(state: PlayerState): Promise<void> {
    const child = this.child
    if (!child) return Promise.resolve()
    const requestId = this.nextRequestId++
    return new Promise<void>((resolve) => {
      this.saveRequests.set(requestId, resolve)
      child.postMessage({ type: 'savePlayerState', requestId, state })
    })
  }

  /**
   * Diskte olmayan kapağı worker'a indirtir (PLAN_v5 A3.2: main'de ağ yok). Worker açılıyorsa hazır
   * olması beklenir; çalışmıyorsa / ölürse `unavailable`, zaman aşımında `failed`.
   */
  async fetchArtwork(url: string): Promise<ArtworkFetchResult | 'unavailable'> {
    let child: ChildLike
    try {
      if (!this.ready) return 'unavailable'
      child = await this.ready
    } catch {
      return 'unavailable'
    }
    const requestId = this.nextRequestId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => done('failed'), this.options.artworkTimeoutMs ?? 30_000)
      const done = (result: ArtworkFetchResult | 'unavailable'): void => {
        clearTimeout(timer)
        this.artworkRequests.delete(requestId)
        resolve(result)
      }
      this.artworkRequests.set(requestId, done)
      child.postMessage({ type: 'fetchArtwork', requestId, url })
    })
  }

  /**
   * Çıkış silmesi, onaylı (2.7 O1). Worker çalışıyorsa silip onaylar (DB açılamamışsa dosyaları
   * kendisi siler); çalışmıyorsa veya silme sırasında ölürse dosyaları main siler. Başarısızlık
   * hata olarak döner (sessizce yutulmaz).
   */
  async clearUserData(): Promise<void> {
    const child = this.child
    const ok = child ? await this.requestClear(child) : false
    if (ok) return
    if (!this.child && this.options.removeDatabaseFiles) {
      await this.options.removeDatabaseFiles()
      return
    }
    throw new CoreError('WORKER_UNAVAILABLE', 'Çıkışta yerel veritabanı silinemedi.')
  }

  private requestClear(child: ChildLike): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean): void => {
        clearTimeout(timer)
        this.clearWaiters.delete(finish)
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), this.options.clearTimeoutMs ?? 10_000)
      this.clearWaiters.add(finish)
      child.postMessage({ type: 'clearUserData' })
    })
  }

  stop(): void {
    this.stopping = true
    this.child?.kill()
    this.child = null
  }
}
