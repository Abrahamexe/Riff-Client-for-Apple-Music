// Arayüz yazı tipleri: Geist + Geist Mono (2026-11-27); dosyalar yalnızca kullanılınca yüklenir.
import '@fontsource/geist/300.css'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist-mono/300.css'
import '@fontsource/geist-mono/400.css'
import './styles/ui.css'
import './styles/shell.css'
import './styles/observatory.css'
import { StrictMode, useEffect, useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { defaultSettings } from '@shared/settings'
import { i18n } from '@core/i18n'
import type { App } from '../app/bootstrap'
import { AppProvider, useSettings } from './context'
import { useLocale } from './hooks/useLocale'
import { Shell } from './shell/Shell'
import { applyAppearance } from './theme/theme'
import { applyTweaks, motionConfigMode } from './theme/tweaks'

// Arayüz kökü (PLAN_v5 B1). React + Motion; Windows "animasyon efektleri" kapalıysa Motion
// animasyonları sadeleştirir (`reducedMotion="user"` → prefers-reduced-motion).

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

/** Tema ayarını ve Windows temasını kök öğeye uygular. */
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
  useEffect(() => {
    applyAppearance(document.documentElement, appearance, systemDark)
  }, [appearance, systemDark])
  useEffect(() => {
    applyTweaks(document.documentElement, tweaks)
  }, [tweaks])
}

/** Dil ayarını i18n'e uygular (boyamadan önce) ve `<html lang>`'ı etkin dile eşitler. */
function useLanguage(): void {
  const preference = useSettings()?.general.language
  useLayoutEffect(() => {
    if (preference) i18n.setPreference(preference)
  }, [preference])
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
}

function Root() {
  useAppearance()
  useLanguage()
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
