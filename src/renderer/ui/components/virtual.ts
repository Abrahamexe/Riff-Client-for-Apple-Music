// Sanal liste hesabı (B4): yalnızca görünür satırlar (+ tampon) çizilir; binlerce satırda kaydırma
// akıcı kalır. Saf hesap (testli); DOM tarafı VirtualRows.tsx.

export interface VisibleRange {
  start: number
  /** Dahil değil. */
  end: number
}

/**
 * @param scrollTop kaydırma kabının kaydırma konumu
 * @param viewport kaydırma kabının görünür yüksekliği
 * @param listTop listenin kaydırma kabı içindeki başlangıcı (üstündeki başlık vb.)
 */
export function visibleRange(
  { scrollTop, viewport, listTop }: { scrollTop: number; viewport: number; listTop: number },
  rowHeight: number,
  total: number,
  overscan = 8
): VisibleRange {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const top = scrollTop - listTop
  const first = Math.floor(top / rowHeight) - overscan
  const last = Math.ceil((top + viewport) / rowHeight) + overscan
  return { start: Math.max(0, Math.min(total, first)), end: Math.max(0, Math.min(total, last)) }
}

/** Bir aralığın dokunduğu sayfa başlangıçları (sayfa sayfa yükleme). */
export function pagesFor(range: VisibleRange, pageSize: number): number[] {
  if (range.end <= range.start) return []
  const out: number[] = []
  for (let p = Math.floor(range.start / pageSize) * pageSize; p < range.end; p += pageSize)
    out.push(p)
  return out
}
