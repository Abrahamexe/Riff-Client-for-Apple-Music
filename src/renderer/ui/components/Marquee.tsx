import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { marqueeTiming } from './marqueeTiming'

// Kayan yazı (geliştirici kararı 2026-10-18, büyük oynatıcıdaki uzun şarkı adı): metin kutuya
// sığmıyorsa yavaşça sola kayar ve kesintisiz başa döner (iki kopya); sığıyorsa sabit durur. Kutu
// boyutu değişince yeniden ölçülür. Hareketi azalt açıkken kaymaz, sonu "…" ile kesilir (CSS).

export function Marquee({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const copy = useRef<HTMLSpanElement>(null)
  /** Taşan metnin genişliği (px); sığıyorsa 0. */
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const b = box.current
    const c = copy.current
    if (!b || !c) return
    const measure = (): void => {
      const w = c.offsetWidth
      setWidth(w > b.clientWidth + 1 ? w : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(b)
    return () => observer.disconnect()
  }, [text])

  const timing = width > 0 ? marqueeTiming(width) : null
  return (
    <div ref={box} className={`marquee${timing ? ' marquee--on' : ''} ${className}`} title={text}>
      <span
        className="marquee__track"
        style={
          timing
            ? ({
                '--marquee-shift': `${-timing.shiftPx}px`,
                '--marquee-duration': `${timing.durationS}s`
              } as CSSProperties)
            : undefined
        }
      >
        <span ref={copy} className="marquee__text">
          {text}
        </span>
        {timing ? (
          <span className="marquee__text" aria-hidden="true">
            {text}
          </span>
        ) : null}
      </span>
    </div>
  )
}
