import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { i18n } from '@core/i18n'
import { shelfEdges, shelfTarget } from './shelfScroll'

// Yatay raf (B4 ek; Apple Music Ana Sayfa rafları): başlık + yana kayan kart sırası. Fareyle üzerine
// gelince iki yanda cam ok damlaları belirir (yalnızca o yönde içerik varsa); tekerlek / dokunmatik
// yüzeyle de kayar. Kart genişliği CSS'te sabit (`--shelf-card`), ok bir "sayfa" kaydırır.

/** `wide`: 16:9 büyük kartlar (B6 canlı radyo); `chart`: dört satırlı numaralı şarkı sütunları (B6). */
export type ShelfSize = 'regular' | 'large' | 'songs' | 'chart' | 'wide'

/** Kart genişliği + aralık (px); shell.css `.shelf-row--*` ile aynı. */
const CARD_STEP: Record<ShelfSize, number> = {
  regular: 176 + 20,
  large: 248 + 20,
  songs: 300 + 20,
  chart: 320 + 20,
  wide: 420 + 20
}

export function Shelf({
  title,
  size = 'regular',
  children
}: {
  /** Boşsa başlık satırı çizilmez (ör. başlığı dışarıda olan raf). */
  title: string
  size?: ShelfSize
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ canPrevious: false, canNext: false })
  const [hover, setHover] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = shelfEdges(row)
        setEdges((e) =>
          e.canPrevious === next.canPrevious && e.canNext === next.canNext ? e : next
        )
      })
    }
    measure()
    row.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => {
      cancelAnimationFrame(frame)
      row.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [])

  const page = useCallback(
    (direction: 1 | -1) => {
      const row = rowRef.current
      if (!row) return
      row.scrollTo({
        left: shelfTarget(row, direction, CARD_STEP[size]),
        behavior: reduced ? 'auto' : 'smooth'
      })
    },
    [size, reduced]
  )

  return (
    <section
      className={`shelf-v2 shelf-v2--${size}`}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {title && <h2 className="shelf__title">{title}</h2>}
      <div className="shelf-v2__viewport">
        <div className={`shelf-row shelf-row--${size}`} ref={rowRef}>
          {children}
        </div>
        <AnimatePresence>
          {hover && edges.canPrevious && (
            <ShelfArrow key="prev" direction={-1} onClick={() => page(-1)} />
          )}
          {hover && edges.canNext && (
            <ShelfArrow key="next" direction={1} onClick={() => page(1)} />
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

function ShelfArrow({ direction, onClick }: { direction: 1 | -1; onClick: () => void }) {
  const Icon = direction === 1 ? ChevronRight : ChevronLeft
  return (
    <motion.button
      type="button"
      className={`shelf-arrow glass shelf-arrow--${direction === 1 ? 'next' : 'previous'}`}
      aria-label={i18n.t(direction === 1 ? 'shelf.next' : 'shelf.previous')}
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
    >
      <Icon size={20} strokeWidth={2.2} />
    </motion.button>
  )
}
