import { motion, useAnimationControls } from 'motion/react'
import { ChevronLeft, House } from 'lucide-react'
import { i18n } from '@core/i18n'
import type { Rect } from './layout'
import { dropletTransition } from './motion'
import { useRouter } from './router'
import { useGo } from './scroll'

// Geri + Ana Sayfa (geliştirici kararı, 2026-10-13): hep sol üstte, hamburger damlasının ya da açık
// sol panelin hemen sağında; panel açılıp kapanırken onunla aynı yayla kayar (bitişik kalır). İkisi
// de hep görünür; geri gidilecek sayfa yokken geri düğmesi soluk ve pasif. Basınca yaylanır, geri
// okunun ucu sola doğru küçük bir itme yapar.

const GAP = 8
const BUTTON_SIZE = 40

export function NavControls({ sidebar, sidebarOpen }: { sidebar: Rect; sidebarOpen: boolean }) {
  const { canGoBack, back, route } = useRouter()
  const go = useGo()
  const arrow = useAnimationControls()
  const onBack = (): void => {
    void arrow.start({ x: [0, -4, 0], transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } })
    back()
  }
  return (
    <motion.div
      className="nav-controls"
      initial={false}
      animate={{ left: sidebar.x + sidebar.width + GAP, top: sidebar.y + 2 }}
      transition={dropletTransition(sidebarOpen)}
    >
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
        onClick={() => go({ name: 'home' })}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      >
        <House size={18} strokeWidth={1.9} aria-hidden="true" />
      </motion.button>
    </motion.div>
  )
}
