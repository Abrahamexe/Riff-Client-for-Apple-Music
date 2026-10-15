import '@fontsource-variable/inter'
import './styles/ui.css'
import './styles/shell.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { defaultSettings } from '@shared/settings'
import type { App } from '../app/bootstrap'
import { AppProvider, useSettings } from './context'
import { Shell } from './shell/Shell'
import { applyAppearance } from './theme/theme'
import { applyTweaks, motionConfigMode, NO_BLUR_MIN_ALPHA } from './theme/tweaks'

// Arayüz kökü (PLAN_v5 B1). React + Motion; Windows "animasyon efektleri" kapalıysa Motion
// animasyonları sadeleştirir (`reducedMotion="user"` → prefers-reduced-motion).

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

/** Tema / saydamlık ayarını ve Windows temasını kök öğeye uygular. */
function useAppearance(): void {
  const settings = useSettings()
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches)
  useEffect(() => {
    const query = darkQuery()
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const appearance = settings?.appearance ?? defaultSettings().appearance
  const tweaks = settings?.tweaks ?? defaultSettings().tweaks
  const minAlpha = tweaks.glassBlur ? 0 : NO_BLUR_MIN_ALPHA
  useEffect(() => {
    applyAppearance(document.documentElement, appearance, systemDark, minAlpha)
  }, [appearance, systemDark, minAlpha])
  useEffect(() => {
    applyTweaks(document.documentElement, tweaks)
  }, [tweaks])
}

function Root() {
  useAppearance()
  const motion = useSettings()?.tweaks.motion ?? 'system'
  return (
    <MotionConfig reducedMotion={motionConfigMode(motion)}>
      <Shell />
    </MotionConfig>
  )
}

export function mountUi(container: HTMLElement, app: App): void {
  createRoot(container).render(
    <StrictMode>
      <AppProvider app={app}>
        <Root />
      </AppProvider>
    </StrictMode>
  )
}
