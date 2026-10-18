import { useRef, useState, type PointerEvent } from 'react'

// Fareyle kaydırma (ilerleme ve ses çubukları; geliştirici hatası 2026-10-18: "çubukta bir yere basınca
// şarkı oraya atlamıyor"). `<input type="range">` fareyi bırakınca ayrıca `change` atar; React ise
// çalarken değeri her karede güncel konuma geri çektiği için o olay ESKİ konumu taşıyordu (ölçüm:
// MiniPlayer'da 117 → hemen 4'e geri sarma; alt çubukta sürükleme durumu eski değerde kalabiliyordu).
// Artık fare kaydırıcıya değil kapsayıcıya bağlı: basınca tutulur (pointer capture), sürükledikçe
// değer gösterilir, bırakınca bir kez uygulanır. Kaydırıcı klavye ve ekran okuyucu için kalır.

/** `clientX`'in çubuktaki karşılığı (0..max). Dolu kısım çubuğun tam genişliğini kullanır. */
export function rangeValueAt(clientX: number, left: number, width: number, max: number): number {
  if (!(width > 0) || !(max > 0)) return 0
  return Math.min(1, Math.max(0, (clientX - left) / width)) * max
}

export interface PointerRange {
  /** Sürüklenirken gösterilecek değer; sürüklenmiyorsa `null`. */
  drag: number | null
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void
    onPointerMove: (e: PointerEvent<HTMLElement>) => void
    onPointerUp: (e: PointerEvent<HTMLElement>) => void
    onPointerCancel: () => void
  }
}

/**
 * `max`: çubuğun üst sınırı (0 ise etkisiz). `onCommit`: bırakınca. `onLive`: sürüklerken her değişimde
 * (ses gibi anında duyulması gerekenler için).
 */
export function usePointerRange(
  max: number,
  onCommit: (value: number) => void,
  onLive?: (value: number) => void
): PointerRange {
  const [drag, setDrag] = useState<number | null>(null)
  const active = useRef(false)
  const valueOf = (e: PointerEvent<HTMLElement>): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return rangeValueAt(e.clientX, r.left, r.width, max)
  }
  const update = (v: number): void => {
    setDrag(v)
    onLive?.(v)
  }
  return {
    drag,
    handlers: {
      onPointerDown: (e) => {
        if (e.button !== 0 || !(max > 0)) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        active.current = true
        update(valueOf(e))
      },
      onPointerMove: (e) => {
        if (active.current) update(valueOf(e))
      },
      onPointerUp: (e) => {
        if (!active.current) return
        active.current = false
        const v = valueOf(e)
        setDrag(null)
        onCommit(v)
      },
      onPointerCancel: () => {
        active.current = false
        setDrag(null)
      }
    }
  }
}
