import { useEffect, useRef } from 'react'
import { i18n } from '@core/i18n'

// İnce ayar (2026-10-14): sağ altta kare hızı göstergesi. Yarım saniyede bir sayılan kare sayısından;
// metin React çizimi olmadan güncellenir (göstergenin kendisi ölçümü bozmasın).

const WINDOW_MS = 500

export function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    let frames = 0
    let since = performance.now()
    let worst = 0
    let last = since
    const tick = (now: number): void => {
      frames++
      worst = Math.max(worst, now - last)
      last = now
      if (now - since >= WINDOW_MS && ref.current) {
        const fps = Math.round((frames * 1000) / (now - since))
        ref.current.textContent = i18n.t('tweaks.fpsValue', { fps, worst: Math.round(worst) })
        frames = 0
        worst = 0
        since = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div ref={ref} className="fps-meter glass" aria-hidden="true" />
}
