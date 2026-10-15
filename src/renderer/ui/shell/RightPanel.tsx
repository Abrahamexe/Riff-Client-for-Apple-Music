import { AnimatePresence, motion } from 'motion/react'
import type { RightPanel as RightPanelMode } from '@shared/settings'
import { i18n } from '@core/i18n'
import type { Rect } from './layout'
import { contentIn, SPRING_OPEN } from './motion'
import { InfoPanel } from './InfoPanel'
import { LyricsPanel } from './LyricsPanel'
import { QueuePanel } from './QueuePanel'

// Sağ sütun (B3): Apple Music gibi şarkı sözleri ve Sıradaki aynı yeri paylaşır; oynatıcıdaki
// düğmelerle açılır/değişir. Sağ alttan (oynatıcıdaki düğmelere yakın) damla gibi büyür.
// §3.5: üçüncü mod "Bilgi" (çalan şarkının müzik arka planı).

const TITLE = { lyrics: 'lyrics.title', queue: 'queue.title', info: 'info.title' } as const

export function RightPanel({ rect, mode }: { rect: Rect; mode: Exclude<RightPanelMode, 'none'> }) {
  const collapsed = {
    left: rect.x + rect.width - 44,
    top: rect.y + rect.height - 44,
    width: 44,
    height: 44,
    opacity: 0
  }
  return (
    <motion.aside
      className="glass right-panel"
      aria-label={i18n.t(TITLE[mode])}
      initial={collapsed}
      animate={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, opacity: 1 }}
      exit={collapsed}
      transition={SPRING_OPEN}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="right-panel__content"
          data-lyrics-scroller=""
          key={mode}
          {...contentIn}
        >
          <h2 className="right-panel__title">{i18n.t(TITLE[mode])}</h2>
          {mode === 'lyrics' ? <LyricsPanel /> : mode === 'queue' ? <QueuePanel /> : <InfoPanel />}
        </motion.div>
      </AnimatePresence>
    </motion.aside>
  )
}
