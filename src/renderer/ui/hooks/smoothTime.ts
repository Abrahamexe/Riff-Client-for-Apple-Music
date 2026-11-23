import { useEffect, useRef, useState } from 'react'

// Akıcı çalma konumu (geliştirici: "şarkı çubuğu takılarak gitmesin kayarak devam etsin"). Player
// konumu saniyede ~4 kez bildirir; arada son bildirimden bu yana geçen süre eklenerek kare kare
// tahmin edilir. Bildirim tahminden biraz farklıysa (ağ, kare gecikmesi) çizgi zıplamaz: fark
// `CATCH_UP_S` içinde yumuşakça kapatılır, çizgi hiç geri gitmez (2026-10-18; önceki sürüm her
// saniye ileri sıçrıyordu). İleri/geri sarma, şarkı değişimi ve duraklamada hemen hizalanır.
// Bildirim gelmezse (ara bellek) tahmin son bildirimden en fazla `MAX_LEAD_S` öne geçer.

export const MAX_LEAD_S = 1.25
/** Küçük farkın kapatıldığı süre; `MAX_LEAD_S`'den uzun olduğu için çizgi geri gitmez. */
export const CATCH_UP_S = 1.5

export class SmoothClock {
  private anchorTime = 0
  private anchorAt = 0
  /** Bildirim ile tahmin arasındaki fark; `CATCH_UP_S` boyunca doğrusal kapatılır. */
  private correction = 0
  private last = 0
  private playing = false

  /** Player'ın bildirdiği konum (`now`: ms, `performance.now()`). */
  report(time: number, playing: boolean, now: number): void {
    const estimate = this.at(now, 0)
    const error = time - estimate
    const snap = !playing || !this.playing || Math.abs(error) > MAX_LEAD_S
    this.last = time
    this.playing = playing
    this.anchorAt = now
    this.anchorTime = snap ? time : estimate
    this.correction = snap ? 0 : error
  }

  /** `now` anındaki tahmini konum (sn); `duration` > 0 ise onu aşmaz. */
  at(now: number, duration: number): number {
    let t = this.last
    if (this.playing) {
      const elapsed = Math.max(0, now - this.anchorAt) / 1000
      const corrected =
        this.anchorTime + elapsed + this.correction * Math.min(1, elapsed / CATCH_UP_S)
      t = Math.min(corrected, this.last + MAX_LEAD_S)
    }
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
