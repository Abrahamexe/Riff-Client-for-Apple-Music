import type { PlayerState } from '@shared/ipc-contract'
import type { Player, PlayerSnapshot } from '../musickit/player'

// Player durumu (kuyruk + konum) periyodik olarak worker'a kaydedilir; uygulama yeniden açılınca
// veya renderer çöküp yeniden yüklenince son kuyruk geri getirilir (PLAN §3 "Çalma", 1.8).

export interface PlayerStateStore {
  savePlayerState(state: PlayerState): Promise<void>
  loadPlayerState(): Promise<PlayerState | null>
}

export interface PersistOptions {
  /** Çalarken en fazla bu sıklıkla kaydedilir. */
  intervalMs?: number
  now?: () => number
  onError?: (err: unknown) => void
}

const MAX_QUEUE = 5_000

/**
 * P3 (B-e): henüz çalınmamış otomatik çalma öğeleri kaydedilmez; geri yüklemede Apple onları yeniden
 * üretir (autoplay açıksa). Kaydedilseydi kullanıcının kuyruğu gibi geri gelirlerdi. Çalan şarkı
 * otomatik çalmadansa ona kadar olanlar kaydedilir (konum kaybolmaz).
 */
export function toPlayerState(snapshot: PlayerSnapshot): PlayerState {
  const { autoplayIndex, position } = snapshot.queue
  const keep =
    autoplayIndex === null ? snapshot.queue.items.length : Math.max(autoplayIndex, position + 1)
  const queue = snapshot.queue.items.slice(0, Math.min(keep, MAX_QUEUE)).map((i) => i.id)
  return {
    queue,
    position: Math.min(Math.max(0, snapshot.queue.position), Math.max(0, queue.length - 1)),
    currentTime: Math.min(Math.max(0, snapshot.currentTime), 86_400)
  }
}

/** Kaydı başlatır; döndürülen fonksiyon dinleyicileri söker. */
export function persistPlayerState(
  player: Player,
  store: Pick<PlayerStateStore, 'savePlayerState'>,
  { intervalMs = 10_000, now = Date.now, onError = () => {} }: PersistOptions = {}
): () => void {
  let lastSave = 0
  const save = (): void => {
    lastSave = now()
    store.savePlayerState(toPlayerState(player.snapshot())).catch(onError)
  }
  const offs = [
    player.on('queueItemsDidChange', save),
    player.on('playbackStateDidChange', ({ state }) => {
      if (state === 'paused' || state === 'stopped' || state === 'completed') save()
    }),
    player.on('playbackTimeDidChange', () => {
      if (now() - lastSave >= intervalMs) save()
    })
  ]
  return () => offs.forEach((off) => off())
}

/**
 * Apple'ın çözemediği kimlikler (MusicKit hata metni: "One or more items could not be resolved: 1, 2").
 * Metin biçimi değişirse boş döner (geri yükleme yalnızca atlanır).
 */
export function unresolvedIds(err: unknown): string[] {
  // Asıl MusicKit metni çoğu zaman `cause` zincirinde (CoreError yalnızca kendi mesajını taşır).
  // MusicKit'in hata nesnesi `Error` olmayabilir: `message` / `description` alanları okunur.
  const parts: string[] = []
  for (let e: unknown = err, depth = 0; e != null && depth < 5; depth++) {
    if (typeof e === 'string') {
      parts.push(e)
      break
    }
    if (typeof e !== 'object') break
    const o = e as { message?: unknown; description?: unknown; cause?: unknown }
    for (const v of [o.message, o.description]) if (typeof v === 'string') parts.push(v)
    e = o.cause
  }
  const text = parts.join(' | ')
  const m = /could not be resolved:\s*([A-Za-z0-9.,\s-]+)/i.exec(text)
  return m ? m[1]!.split(/[\s,]+/).filter(Boolean) : []
}

/**
 * Kayıtlı kuyruğu çalmaya başlamadan geri yükler. Kayıt yoksa ya da geri yüklenemezse `false`;
 * HİÇBİR ZAMAN fırlatmaz (2026-10-14 hatası: kuyrukta Apple'ın artık çözemediği bir şarkı vardı,
 * geri yükleme hatası oturum geri yüklemesini de düşürüyor, açılış takılıyordu). Çözülemeyen
 * kimlikler atılıp bir kez daha denenir; çalan şarkı atıldıysa sonrakinden, baştan başlar.
 */
export async function restorePlayerState(
  player: Player,
  store: Pick<PlayerStateStore, 'loadPlayerState'>,
  onError?: (err: unknown) => void
): Promise<boolean> {
  const state = await store.loadPlayerState().catch((err: unknown) => {
    onError?.(err)
    return null
  })
  if (!state || state.queue.length === 0) return false
  try {
    await player.restoreQueue(state)
    return true
  } catch (err) {
    const bad = new Set(unresolvedIds(err))
    const kept = state.queue.map((id, index) => ({ id, index })).filter((x) => !bad.has(x.id))
    if (bad.size === 0 || kept.length === 0) {
      onError?.(err)
      return false
    }
    const at = kept.findIndex((x) => x.index >= state.position)
    const position = at < 0 ? kept.length - 1 : at
    const sameSong = kept[position]!.index === state.position
    try {
      await player.restoreQueue({
        queue: kept.map((x) => x.id),
        position,
        currentTime: sameSong ? state.currentTime : 0
      })
      return true
    } catch (retryErr) {
      onError?.(retryErr)
      return false
    }
  }
}
