// Yan panel açılıp kapanırken ana ekranın kenarları kare kare değişir (Shell.tsx, 2026-11-23). O sırada
// içerikteki ölçümler (raf kartı genişliği, raf okları) her karede zorunlu yerleşim yaptırıp kare
// atlatıyordu. Ölçen bileşenler hareket sürerken bekler; hareket bitince bir kez yeniden ölçer.

type Listener = () => void

let moving = false
const listeners = new Set<Listener>()

/** Ana ekranın kenarları şu an canlanıyor mu. */
export function isEdgeMoving(): boolean {
  return moving
}

/** Hareket başladı / bitti. Bitince bekleyen ölçümler çalışır. */
export function setEdgeMoving(next: boolean): void {
  if (moving === next) return
  moving = next
  if (!next) for (const listener of [...listeners]) listener()
}

/** Hareket bitince çağrılır; dönen işlev aboneliği kaldırır. */
export function onEdgeSettled(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
