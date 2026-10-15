import { useEffect, useRef, useState } from 'react'
import { activeLineIndex, type LyricLine } from '@core/background/lyrics'
import { SmoothClock } from './smoothTime'

// Çalan söz satırı (B11b). Konum ilerleme çubuğundaki `SmoothClock` ile kare kare tahmin edilir
// (MusicKit ~1 sn'de bir bildirir); bileşen yalnızca satır DEĞİŞİNCE yeniden çizilir, her karede
// değil. Duraklamada ve pencere gizliyken (rAF durur) hesap yapılmaz.

export function useActiveLine(
  lines: readonly LyricLine[],
  reported: number,
  duration: number,
  playing: boolean,
  /** İnce ayar: + sözleri öne alır (erken gösterir), − geciktirir (ms). */
  offsetMs = 0
): number {
  const clock = useRef<SmoothClock | null>(null)
  clock.current ??= new SmoothClock()
  const [index, setIndex] = useState(-1)

  useEffect(() => {
    const c = clock.current!
    const update = (): void =>
      setIndex(activeLineIndex(lines, c.at(performance.now(), duration) * 1000 + offsetMs))
    c.report(reported, playing, performance.now())
    update()
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      update()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [lines, reported, duration, playing, offsetMs])

  return index
}
