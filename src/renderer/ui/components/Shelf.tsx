import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { i18n } from '@core/i18n'
import { isEdgeMoving, onEdgeMotion, onEdgeSettled } from '../hooks/edgeMotion'
import { CARD_GAP, fitCardWidth, shelfEdges, shelfTarget } from './shelfScroll'

// Yatay raf (B4 ek; Apple Music Ana Sayfa rafları): başlık + yana kayan kart sırası. Fareyle üzerine
// gelince iki yanda cam ok damlaları belirir (yalnızca o yönde içerik varsa); tekerlek / dokunmatik
// yüzeyle de kayar. Kart genişliği CSS'te taban değer (`--shelf-card`); ölçülünce sığan tam sütun sayısına
// göre büyür (yarım kart görünmez), öğe azsa satırı doldurur. Ok bir "sayfa" kaydırır.

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

/** Kare kartlı raflar: ok düğmesi kapak hizasında (kart genişliği = kapak yüksekliği). */
const SQUARE_SIZES: readonly ShelfSize[] = ['regular', 'large']
/** Bir sütundaki satır sayısı (shell.css `grid-template-rows`); öğe sayısı → sütun sayısı. */
const ROWS: Record<ShelfSize, number> = { regular: 1, large: 1, songs: 3, chart: 4, wide: 1 }
const ROW_PADDING = 20

/** Ok düğmesinin dikey hizası: kare kartta kapak = kart genişliği, geniş kartta 16:9. */
function arrowStyle(size: ShelfSize, fit: number): CSSProperties | undefined {
  if (SQUARE_SIZES.includes(size)) return { '--shelf-card-fit': `${fit}px` } as CSSProperties
  if (size === 'wide') return { '--arrow-art': `${(fit * 9) / 16}px` } as CSSProperties
  return undefined
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
  const [fit, setFit] = useState<number | null>(null)
  const reduced = useReducedMotion()
  // 2026-11-02: tüm raflar sığan tam sütun sayısına göre ölçülür (yarım kart yok) ve öğe azsa sütunlar
  // büyüyüp satırı doldurur (geliştirici: "tam ekranda sağda boşluk kalmasın").
  const columns = Math.ceil(Children.toArray(children).length / ROWS[size])

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const base = CARD_STEP[size] - CARD_GAP
    const fitFor = (width: number): number | null =>
      width > 0 ? fitCardWidth(width, base, columns) : null
    const update = (): void => {
      // Yan panel açılıp kapanırken genişlik aşağıdaki kareler yazar; bitince bir kez (edgeMotion.ts).
      if (isEdgeMoving()) return
      const next = fitFor(row.clientWidth - ROW_PADDING * 2)
      if (next === null) return
      row.style.setProperty('--shelf-card', `${next}px`)
      setFit((f) => (f === next ? f : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    // 2026-11-23 (geliştirici: "raf kartları rahatsız ediyor"): panel açılırken kartlar hedef
    // genişliklerine panelle aynı yayla, kare kare geçer. Yalnızca CSS değişkeni yazılır (React çizmez).
    let from: number | null = null
    let to: number | null = null
    const offMotion = onEdgeMotion({
      start: (delta) => {
        const width = row.clientWidth - ROW_PADDING * 2
        from = fitFor(width)
        to = fitFor(width + delta)
        // Hedef genişlik değişkene bir kez yazılır (oynat düğmesi gibi `--shelf-card`'a bağlı soy
        // öğeler tek seferde kurulur); kareler yalnızca satırın kendi `grid-auto-columns`'ını sürer.
        // Değişken kare kare yazılınca soyundaki ~600 öğenin stili her karede yeniden hesaplanıyordu
        // (ölçüm: ~3 ms/kare, 144 Hz'de kare atlatıyordu).
        if (to !== null) row.style.setProperty('--shelf-card', `${to}px`)
      },
      frame: (p) => {
        if (from === null || to === null) return
        row.style.gridAutoColumns = `${from + (to - from) * p}px`
      },
      settled: () => {
        from = to = null
        row.style.removeProperty('grid-auto-columns')
        update()
      }
    })
    return () => {
      observer.disconnect()
      offMotion()
    }
  }, [size, columns])

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    let frame = 0
    const measure = (): void => {
      if (isEdgeMoving()) return
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
    const offSettled = onEdgeSettled(measure)
    return () => {
      cancelAnimationFrame(frame)
      row.removeEventListener('scroll', measure)
      observer.disconnect()
      offSettled()
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
      <div className="shelf-v2__viewport" style={fit ? arrowStyle(size, fit) : undefined}>
        <div
          className={`shelf-row shelf-row--${size}`}
          ref={rowRef}
          style={fit ? ({ '--shelf-card': `${fit}px` } as CSSProperties) : undefined}
        >
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
