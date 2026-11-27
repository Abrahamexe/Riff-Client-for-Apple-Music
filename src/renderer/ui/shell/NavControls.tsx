import { motion, useAnimationControls } from 'motion/react'
import { ChevronLeft, House } from 'lucide-react'
import { i18n } from '@core/i18n'
import { NAV_BUTTON_SIZE } from './layout'
import { useRouter } from './router'
import { useGo } from './scroll'

// Geri + Ana Sayfa (geliştirici kararı, 2026-10-13): hep sol üst köşede (2026-11-23: menü tuşu
// oynatıcıya indi, damla kalktı; düğmeler köşeye yerleşti, sol panel üst şeridin altında). İkisi
// de hep görünür; geri gidilecek sayfa yokken geri düğmesi soluk ve pasif. Basınca yaylanır, geri
// okunun ucu sola doğru küçük bir itme yapar.

const BUTTON_SIZE = NAV_BUTTON_SIZE

export function NavControls({
  onHome,
  left,
  top
}: {
  onHome?: () => void
  /** Üst şeridin solunda, kitaplığın sağında (Shell.tsx). */
  left: number
  top: number
}) {
  const { canGoBack, back, route } = useRouter()
  const go = useGo()
  const arrow = useAnimationControls()
  const onBack = (): void => {
    void arrow.start({ x: [0, -4, 0], transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } })
    back()
  }
  return (
    <div className="nav-controls" style={{ left, top }}>
      <motion.button
        type="button"
        className="glass glass--capsule nav-control"
        style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
        aria-label={i18n.t('nav.back')}
        title={i18n.t('nav.back')}
        disabled={!canGoBack}
        onClick={onBack}
        initial={false}
        animate={{ opacity: canGoBack ? 1 : 0.4, scale: canGoBack ? 1 : 0.94 }}
        whileHover={canGoBack ? { scale: 1.08 } : {}}
        whileTap={canGoBack ? { scale: 0.9 } : {}}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      >
        <motion.span className="nav-control__icon" animate={arrow}>
          <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
        </motion.span>
      </motion.button>
      <motion.button
        type="button"
        className={`glass glass--capsule nav-control${route.name === 'home' ? ' nav-control--current' : ''}`}
        style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
        aria-label={i18n.t('nav.home')}
        title={i18n.t('nav.home')}
        aria-current={route.name === 'home' ? 'page' : undefined}
        onClick={() => {
          onHome?.()
          go({ name: 'home' })
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      >
        <House size={18} strokeWidth={1.9} aria-hidden="true" />
      </motion.button>
    </div>
  )
}
