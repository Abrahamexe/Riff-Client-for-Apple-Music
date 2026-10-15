import { useEffect, useRef, useState } from 'react'

// Akıcı çalma konumu (geliştirici: "şarkı çubuğu takılarak gitmesin kayarak devam etsin"). MusicKit
// konumu yaklaşık saniyede bir bildirir; çubuk her bildirimde zıplıyordu. Son bildirimden bu yana
// geçen süre eklenerek kare kare tahmin edilir. Bildirim tahminin biraz gerisindeyse (yuvarlanmış
// saniye) çizgi geri gitmez; ileri sarma, şarkı değişimi ya da büyük sapmada yeniden hizalanır.
// Bildirim gelmezse (ara bellek) tahmin son bildirimden en fazla `MAX_LEAD_S` öne geçer.

export const MAX_LEAD_S = 1.25

export class SmoothClock {
  private anchorTime = 0
  private anchorAt = 0
  private last = 0
  private playing = false

  /** MusicKit'in bildirdiği konum (`now`: ms, `performance.now()`). */
  report(time: number, playing: boolean, now: number): void {
    const estimate = this.at(now, 0)
    const resync = !playing || !this.playing || time > estimate || estimate - time > MAX_LEAD_S
    this.last = time
    this.playing = playing
    if (resync) {
      this.anchorTime = time
      this.anchorAt = now
    }
  }

  /** `now` anındaki tahmini konum (sn); `duration` > 0 ise onu aşmaz. */
  at(now: number, duration: number): number {
    const t = this.playing
      ? Math.min(this.anchorTime + Math.max(0, now - this.anchorAt) / 1000, this.last + MAX_LEAD_S)
      : this.last
    return duration > 0 ? Math.min(t, duration) : t
  }
}

/** Çalarken her karede güncellenen konum; duraklamada bildirilen değer. Pencere gizliyken durur. */
export function useSmoothTime(reported: number, duration: number, playing: boolean): number {
  const clock = useRef<SmoothClock | null>(null)
  clock.current ??= new SmoothClock()
  const [value, setValue] = useState(reported)

  useEffect(() => {
    const c = clock.current!
    c.report(reported, playing, performance.now())
    setValue(c.at(performance.now(), duration))
  }, [reported, playing, duration])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      setValue(clock.current!.at(performance.now(), duration))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration])

  return value
}
