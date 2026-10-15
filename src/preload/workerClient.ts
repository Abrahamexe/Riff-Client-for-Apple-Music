import {
  workerContract,
  workerEventContract,
  type WorkerApi,
  type WorkerEventName,
  type WorkerMethod
} from '@shared/ipc-contract'
import { logError } from '@shared/errors'
import type { IpcResult } from '@shared/types'

// Renderer ↔ worker MessagePort istemcisi (PLAN 1.7a). Port preload'da kalır, renderer'a verilmez;
// renderer yalnızca sözleşmedeki yöntemleri çağırabilir (genel `request(method)` açılmaz).
// Her istek bir IpcResult ile SONUÇLANIR (reject yok); worker yanıt vermezse WORKER_UNAVAILABLE.

/** DOM `MessagePort`'un kullandığımız yüzeyi. */
export interface PortLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  /** Karşı uç kapandı (worker çöktü / yeniden başladı; PLAN 2.3). */
  addEventListener(type: 'close', listener: () => void): void
  start(): void
  close(): void
}

const DEFAULT_TIMEOUT_MS = 30_000
/** Port yokken kuyrukta bekleyebilecek en fazla istek. */
const MAX_QUEUED = 500

const unavailable: IpcResult<never> = {
  ok: false,
  error: { code: 'WORKER_UNAVAILABLE', message: 'Yerel veri servisi yanıt vermedi.' }
}

export class WorkerClient {
  private port: PortLike | null = null
  private queue: unknown[] = []
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (r: IpcResult<unknown>) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  /** Main'in gönderdiği portu bağlar; bekleyen istekler gönderilir. Yeni port eskisinin yerini alır. */
  attach(port: PortLike): void {
    this.port?.close()
    this.port = port
    port.addEventListener('message', (event) => this.onMessage(event.data))
    // PLAN 2.3: worker çökerse yanıt gelmeyecek istekler zaman aşımını beklemeden biter; yeni
    // istekler supervisor'ın yeniden başlattığı worker'ın portu gelene kadar kuyrukta bekler.
    port.addEventListener('close', () => {
      if (this.port !== port) return
      this.port = null
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.resolve(unavailable)
      }
    })
    port.start()
    const queued = this.queue
    this.queue = []
    for (const message of queued) port.postMessage(message)
  }

  request(method: WorkerMethod, params: unknown): Promise<IpcResult<unknown>> {
    const id = this.nextId++
    // 2.7 D4: worker hiç gelmezse kuyruk sınırsız büyümesin.
    if (!this.port && this.queue.length >= MAX_QUEUED) return Promise.resolve(unavailable)
    return new Promise((resolve) => {
      const message = { id, method, params }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // 2.7 D4: zaman aşımına uğrayan istek port gelince bayat olarak gönderilmez.
        const queued = this.queue.indexOf(message)
        if (queued >= 0) this.queue.splice(queued, 1)
        resolve(unavailable)
      }, this.timeoutMs)
      this.pending.set(id, { resolve, timer })
      if (this.port) this.port.postMessage(message)
      else this.queue.push(message)
    })
  }

  on(event: string, listener: (payload: unknown) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener)
    return () => void set.delete(listener)
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const msg = data as { id?: unknown; result?: unknown; event?: unknown; payload?: unknown }

    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      pending.resolve(msg.result as IpcResult<unknown>)
      return
    }

    if (typeof msg.event === 'string') {
      const def = Object.values(workerEventContract).find((d) => d.event === msg.event)
      const parsed = def?.payload.safeParse(msg.payload)
      if (!parsed?.success) return
      for (const listener of [...(this.listeners.get(msg.event) ?? [])]) {
        try {
          listener(parsed.data)
        } catch (err) {
          logError('preload', err, 'INTERNAL', `${msg.event} dinleyicisi hata verdi`)
        }
      }
    }
  }
}

/** `window.api.worker`: sözleşmedeki her yöntem için sabit yöntemli bir fonksiyon. */
export function buildWorkerApi(client: WorkerClient): WorkerApi {
  const api: Record<string, unknown> = {}
  for (const method of Object.keys(workerContract) as WorkerMethod[]) {
    api[method] = (params: unknown) => client.request(method, params)
  }
  for (const name of Object.keys(workerEventContract) as WorkerEventName[]) {
    const { event } = workerEventContract[name]
    api[name] = (listener: (payload: unknown) => void) => client.on(event, listener)
  }
  return Object.freeze(api) as WorkerApi
}
