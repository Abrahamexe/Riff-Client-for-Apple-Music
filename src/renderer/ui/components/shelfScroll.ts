// Yatay raf kaydırma hesabı (B4 ek, saf): ok düğmeleri hangi uçta görünür, bir basışta ne kadar
// kayılır. Bir basış görünen genişliğin tamamı kadar kayar, son kartın yarısı yeni sayfada da
// görünsün diye bir kart payı geri bırakılır (Apple Music rafları gibi sayfa sayfa).

export interface ShelfMetrics {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
}

/** Kenara bu kadar yakınsa "uçta" sayılır (alt piksel yuvarlama). */
const EDGE = 2

export function shelfEdges(m: ShelfMetrics): { canPrevious: boolean; canNext: boolean } {
  return {
    canPrevious: m.scrollLeft > EDGE,
    canNext: m.scrollLeft + m.clientWidth < m.scrollWidth - EDGE
  }
}

/** Bir basışta kayılacak hedef konum (sınırlar içinde). */
export function shelfTarget(m: ShelfMetrics, direction: 1 | -1, cardStep: number): number {
  const page = Math.max(cardStep, m.clientWidth - cardStep)
  const max = Math.max(0, m.scrollWidth - m.clientWidth)
  return Math.min(max, Math.max(0, m.scrollLeft + direction * page))
}
