import { logError } from '@shared/errors'

// Tipli event emitter. UI'ın dinleyeceği tek kaynak (PLAN 1.8).

export type Listener<T> = (payload: T) => void

export class TypedEmitter<Events extends { [K in keyof Events]: unknown }> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>()

  /** Abonelikten çıkan bir fonksiyon döner. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener)
    return () => this.off(event, listener)
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener)
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        ;(listener as Listener<Events[K]>)(payload)
      } catch (err) {
        // Bir dinleyicinin hatası diğerlerini ve çalmayı etkilemesin.
        logError('emitter', err, 'INTERNAL', `'${String(event)}' dinleyicisi hata verdi`)
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear()
  }
}
