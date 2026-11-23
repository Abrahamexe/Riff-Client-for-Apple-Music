// Yan panel açılıp kapanırken ana ekranın kenarları kare kare değişir (Shell.tsx, 2026-11-23). O sırada
// içerikteki ölçümler (raf kartı genişliği, raf okları, kaydırma çubuğu) her karede zorunlu yerleşim
// yaptırıp kare atlatıyordu. Ölçen bileşenler hareket sürerken ölçmez:
//  - hareket başlarken sayfa genişliğinin ne kadar değişeceği bildirilir (`startEdgeMotion`); raflar
//    hedef kart genişliğini bir kez hesaplar;
//  - her karede ilerleme (0 → 1) bildirilir; raflar kart genişliğini aradan yazar (React çizmeden);
//  - bitince bekleyen ölçümler bir kez çalışır.

export interface EdgeMotionHandlers {
  /** Hareket başladı; sayfa genişliği `deltaWidth` px değişecek. */
  start?: (deltaWidth: number) => void
  /** Hareketin ilerlemesi (0 → 1; yay sekerse biraz taşabilir). */
  frame?: (progress: number) => void
  /** Hareket bitti (yeniden ölç). */
  settled?: () => void
}

let moving = false
const handlers = new Set<EdgeMotionHandlers>()

/** Ana ekranın kenarları şu an canlanıyor mu. */
export function isEdgeMoving(): boolean {
  return moving
}

export function startEdgeMotion(deltaWidth: number): void {
  moving = true
  for (const h of [...handlers]) h.start?.(deltaWidth)
}

export function edgeMotionFrame(progress: number): void {
  if (!moving) return
  for (const h of [...handlers]) h.frame?.(progress)
}

export function endEdgeMotion(): void {
  if (!moving) return
  moving = false
  for (const h of [...handlers]) h.settled?.()
}

/** Abone ol; dönen işlev aboneliği kaldırır. */
export function onEdgeMotion(h: EdgeMotionHandlers): () => void {
  handlers.add(h)
  return () => {
    handlers.delete(h)
  }
}

/** Yalnızca bitişi dinleyenler için kısayol. */
export function onEdgeSettled(listener: () => void): () => void {
  return onEdgeMotion({ settled: listener })
}
