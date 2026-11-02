import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { RightPanel as RightPanelMode } from '@shared/settings'
import { i18n } from '@core/i18n'
import type { Rect } from './layout'
import { contentIn, isExitDefinition, rightPanelMotion } from './motion'
import { InfoPanel } from './InfoPanel'
import { LyricsPanel } from './LyricsPanel'
import { PanelSettledContext } from './panelSettled'
import { QueuePanel } from './QueuePanel'

// Sağ sütun (B3): Apple Music gibi şarkı sözleri ve Sıradaki aynı yeri paylaşır; oynatıcıdaki
// düğmelerle açılır/değişir. Sağ alttan (oynatıcıdaki düğmelere yakın) damla gibi büyür.
// §3.5: üçüncü mod "Bilgi" (çalan şarkının müzik arka planı).

const TITLE = { lyrics: 'lyrics.title', queue: 'queue.title', info: 'info.title' } as const

export function RightPanel({
  rect,
  mode,
  onSettled
}: {
  rect: Rect
  mode: Exclude<RightPanelMode, 'none'>
  /** Açılış animasyonu bitti (ana ekran yeni genişliğini ancak o zaman alır, Shell.tsx). */
  onSettled?: () => void
}) {
  // 2026-11-02 (geliştirici: "açılınca ana ekranda kasma"): ölçüm (1920 px, 144 Hz) Sıradaki açılışında
  // 900 ms'de 61 kare, en uzun 62 ms — panelin `left/top/width/height`'ı her karede değişip tüm satırları
  // yeniden diziyordu. Panel artık hep son boyutunda; sol menü gibi yalnızca ölçek + opaklıkla, oynatıcı
  // düğmelerinin olduğu sağ alt köşeden açılır. Ağır listeler açılış bitince kurulur (`panelSettled.ts`).
  const [settled, setSettled] = useState(false)
  return (
    <motion.aside
      className="glass right-panel"
      aria-label={i18n.t(TITLE[mode])}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      {...rightPanelMotion}
      onAnimationComplete={(definition) => {
        // Kapanış (exit, opaklık 0) da bu olayı verir; yalnızca açılışın sonu sayılır.
        if (isExitDefinition(definition)) return
        setSettled(true)
        onSettled?.()
      }}
    >
      <PanelSettledContext.Provider value={settled}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="right-panel__content"
            data-lyrics-scroller=""
            key={mode}
            {...contentIn}
          >
            <h2 className="right-panel__title">{i18n.t(TITLE[mode])}</h2>
            {mode === 'lyrics' ? (
              <LyricsPanel />
            ) : mode === 'queue' ? (
              <QueuePanel />
            ) : (
              <InfoPanel />
            )}
          </motion.div>
        </AnimatePresence>
      </PanelSettledContext.Provider>
    </motion.aside>
  )
}
