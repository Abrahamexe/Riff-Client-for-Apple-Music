import '@fontsource-variable/inter'
import './ui/styles/mini.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { installWindowErrorHandlers } from '@shared/errors/global'
import { MiniPlayer } from './ui/mini/MiniPlayer'
import { ipcRemoteHubPort } from './playerHub'
import { unwrap } from './ipc'

// B12b MiniPlayer penceresinin girişi. Ana pencereye dönüş main'de: bu pencere kapanır, ana pencere
// gösterilir (window:closeMini yalnızca bu pencereden kabul edilir).
installWindowErrorHandlers('renderer', window)

const expand = (): void => {
  unwrap(window.api.closeMiniPlayer()).catch((err: unknown) =>
    console.warn('[mini] kapatılamadı', err)
  )
}

createRoot(document.getElementById('mini-root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <MiniPlayer port={ipcRemoteHubPort} onExpand={expand} />
    </MotionConfig>
  </StrictMode>
)
