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

/** Raf kartları arası boşluk (px); shell.css `.shelf-row` `gap` ile aynı. */
export const CARD_GAP = 20

/**
 * Öğe azken kartın büyüyebileceği en fazla oran (2026-11-02): satırı doldurmak için büyür ama 1–2 öğelik
 * rafta dev kart çıkmasın.
 */
export const MAX_CARD_GROWTH = 1.5

/**
 * Satır içeriği `width` px iken kart genişliği: sığan tam kart sayısı için `base`'den büyür; hiç sığmazsa
 * `base`. `items` verilirse ve sığan sayıdan azsa (2026-11-02, geliştirici: "tam ekranda sağda boşluk
 * kalmasın"), kartlar o sayıya göre büyüyüp satırı doldurur — en fazla `MAX_CARD_GROWTH` × `base`.
 */
export function fitCardWidth(width: number, base: number, items?: number): number {
  const fits = Math.max(1, Math.floor((width + CARD_GAP) / (base + CARD_GAP)))
  let count = fits
  if (items !== undefined && items > 0 && items < fits) {
    // En az bu kadar sütun: kart MAX_CARD_GROWTH × base'i aşmasın.
    const minCount = Math.ceil((width + CARD_GAP) / (base * MAX_CARD_GROWTH + CARD_GAP))
    count = Math.min(fits, Math.max(items, minCount))
  }
  // Ondalık kalır (yalnızca 0,01 px aşağı): tam sayıya inince sonraki kartın kenarı satır dolgusuna sızıyordu.
  return Math.floor(((width - (count - 1) * CARD_GAP) / count) * 100) / 100
}
