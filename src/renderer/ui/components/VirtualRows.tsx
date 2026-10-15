import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMainScroll } from '../shell/scroll'
import { pagesFor, visibleRange } from './virtual'

// Sanal satırlar (B4): ana ekranın kaydırmasını kullanır; yalnızca görünür satırlar çizilir, veri
// sayfa sayfa (varsayılan 100) istenir. `resetKey` değişince (sıralama, senkron) önbellek boşalır.

export function VirtualRows<T>({
  total,
  rowHeight,
  pageSize = 100,
  resetKey,
  loadPage,
  renderRow
}: {
  total: number
  rowHeight: number
  pageSize?: number
  resetKey: string
  loadPage: (offset: number, limit: number) => Promise<T[]>
  renderRow: (item: T | undefined, index: number) => ReactNode
}) {
  const scroller = useMainScroll()
  const container = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const pages = useRef(new Map<number, T[]>())
  const loading = useRef(new Set<number>())
  const [, setVersion] = useState(0)
  /** Yanıt gelene kadar sıralama/senkron değiştiyse eski sayfa yazılmaz. */
  const currentKey = useRef(resetKey)

  useEffect(() => {
    currentKey.current = resetKey
    pages.current = new Map()
    loading.current = new Set()
    setVersion((v) => v + 1)
  }, [resetKey])

  useEffect(() => {
    const el = container.current
    if (!scroller || !el) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const listTop =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      setRange(
        visibleRange(
          { scrollTop: scroller.scrollTop, viewport: scroller.clientHeight, listTop },
          rowHeight,
          total
        )
      )
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    // Sayfa geçişinde önceki sayfa çıkış animasyonu boyunca yerinde kalır; liste ilk ölçümde ekranın
    // altında sanılır ve sonra olay olmadan yerine kayar (B4 gözlemi). Liste görünür alana girince /
    // çıkınca yeniden ölçülür.
    const io = new IntersectionObserver(schedule, { root: scroller, threshold: [0, 0.01] })
    io.observe(el)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      io.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scroller, rowHeight, total])

  useEffect(() => {
    for (const offset of pagesFor(range, pageSize)) {
      if (pages.current.has(offset) || loading.current.has(offset)) continue
      loading.current.add(offset)
      const key = resetKey
      void loadPage(offset, pageSize)
        .then((items) => {
          if (key !== currentKey.current) return
          pages.current.set(offset, items)
          setVersion((v) => v + 1)
        })
        .catch(() => {})
        .finally(() => loading.current.delete(offset))
    }
  }, [range, pageSize, loadPage, resetKey])

  const rows: ReactNode[] = []
  for (let i = range.start; i < range.end; i++) {
    const page = pages.current.get(Math.floor(i / pageSize) * pageSize)
    rows.push(
      <div
        key={i}
        className="vrow"
        style={{ transform: `translateY(${i * rowHeight}px)`, height: rowHeight }}
      >
        {renderRow(page?.[i % pageSize], i)}
      </div>
    )
  }
  return (
    <div ref={container} className="vlist" style={{ height: total * rowHeight }}>
      {rows}
    </div>
  )
}
