import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import type { Settings } from '@shared/settings'
import { i18n } from '@core/i18n'
import { qualityInfo } from './quality'

/**
 * Kalite rozeti (geliştirici isteği 2026-10-15): alt oynatıcı kapsülünün sağ üst köşesinde ve büyük
 * oynatıcıda kapakla çubuk arasında; basınca üstünde küçük cam baloncukta kalite adı + bit hızı. Oynatıcı çubuğu taşanı kırptığı için baloncuk
 * `body`'ye taşınır; dışarı tıklama veya Esc kapatır.
 */
export function QualityBadge({
  quality,
  className
}: {
  quality: Settings['playback']['streamingQuality']
  className?: string
}) {
  const info = qualityInfo(quality)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!anchor) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setAnchor(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAnchor(null)
    }
    const close = (): void => setAnchor(null)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [anchor])

  const toggle = (): void => {
    const r = button.current?.getBoundingClientRect()
    setAnchor(anchor || !r ? null : { x: r.left + r.width / 2, y: r.top })
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`quality-badge${className ? ` ${className}` : ''}`}
        aria-label={i18n.t('player.quality')}
        aria-expanded={anchor !== null}
        onClick={toggle}
      >
        {info.badge}
      </button>
      {createPortal(
        <AnimatePresence>
          {anchor ? (
            <motion.div
              ref={pop}
              className="glass quality-pop"
              role="dialog"
              aria-label={i18n.t('player.quality')}
              style={{ left: anchor.x, top: anchor.y }}
              initial={{ opacity: 0, scale: 0.85, x: '-50%', y: 'calc(-100% - 4px)' }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: 'calc(-100% - 10px)' }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 32 }}
            >
              <div className="quality-pop__title">{i18n.t(info.nameKey)}</div>
              <div className="quality-pop__value">
                {i18n.t('player.qualityFormat', { kbps: info.kbps })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
