import { useEffect, useRef, useState, type PointerEvent } from 'react'

// Ana ekranın kaydırma çubuğu (2026-10-19, geliştirici: "sağdaki çubuk ayrı bir bölme olmasın,
// uygulamaya dahil, hafif şeffaf olsun; sayfa tonu orada koyu kalmasın"). Yerel çubuk gizlenir (yer
// kaplıyordu, sayfa tonu altına giremiyordu); yerine içeriğin üstünde duran ince şeffaf bir tutamaç.
// Kaydırırken, üzerine gelince ve sürüklerken görünür; sonra söner.

const TOP_INSET = 8
const MIN_THUMB = 40
const IDLE_MS = 900

interface Metrics {
  /** Çubuk alanı (viewport koordinatı). */
  top: number
  height: number
  right: number
  thumbTop: number
  thumbHeight: number
  /** Kaydırılacak toplam mesafe ile çubuk hareket mesafesi oranı. */
  ratio: number
  scrollable: boolean
}

export function MainScrollbar({
  element,
  paddingTop,
  paddingBottom
}: {
  element: HTMLElement | null
  paddingTop: number
  paddingBottom: number
}) {
  const [m, setM] = useState<Metrics | null>(null)
  const [awake, setAwake] = useState(false)
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drag = useRef<{ y: number; scroll: number } | null>(null)

  useEffect(() => {
    if (!element) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const r = element.getBoundingClientRect()
      const trackTop = r.top + paddingTop + TOP_INSET
      const trackHeight = Math.max(0, r.height - paddingTop - paddingBottom - TOP_INSET)
      const range = element.scrollHeight - element.clientHeight
      const scrollable = range > 1 && trackHeight > MIN_THUMB
      const thumbHeight = scrollable
        ? Math.max(MIN_THUMB, (trackHeight * element.clientHeight) / element.scrollHeight)
        : 0
      const travel = trackHeight - thumbHeight
      setM({
        top: trackTop,
        height: trackHeight,
        right: window.innerWidth - r.right,
        thumbTop: scrollable ? (element.scrollTop / range) * travel : 0,
        thumbHeight,
        ratio: travel > 0 ? range / travel : 0,
        scrollable
      })
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const onScroll = (): void => {
      schedule()
      setAwake(true)
      clearTimeout(idle.current)
      idle.current = setTimeout(() => setAwake(false), IDLE_MS)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', schedule)
    // Sayfa yüksekliği ve ana ekranın genişliği (sağ panel yayla açılır) değişince.
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    const stack = element.firstElementChild
    if (stack) observer.observe(stack)
    schedule()
    return () => {
      element.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(idle.current)
    }
  }, [element, paddingTop, paddingBottom])

  if (!element || !m?.scrollable) return null

  const startDrag = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, scroll: element.scrollTop }
    setDragging(true)
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (d) element.scrollTop = d.scroll + (e.clientY - d.y) * m.ratio
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  // Boş alana basınca o oranda atlar.
  const jump = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const travel = m.height - m.thumbHeight
    if (travel <= 0) return
    const y = e.clientY - m.top - m.thumbHeight / 2
    element.scrollTop =
      (Math.min(Math.max(y, 0), travel) / travel) * (element.scrollHeight - element.clientHeight)
  }

  const shown = awake || hover || dragging
  return (
    <div
      className="main-scrollbar"
      style={{ top: m.top, height: m.height, right: m.right }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={jump}
    >
      <div
        className={`main-scrollbar__thumb${shown ? ' main-scrollbar__thumb--shown' : ''}${dragging ? ' main-scrollbar__thumb--drag' : ''}`}
        style={{ height: m.thumbHeight, transform: `translateY(${m.thumbTop}px)` }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  )
}
