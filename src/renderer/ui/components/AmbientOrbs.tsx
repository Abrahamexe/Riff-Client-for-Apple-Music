import type { CSSProperties } from 'react'
import { pickOrbs } from './orbPalette'

// Kapaksız sayfaların (Ana Sayfa, kütüphane, arama…) arka planı: koyu zeminde süzülen renk küreleri
// (geliştirici isteği 2026-10-21: "arka plan sıkıcı, düz"). 2026-11-02: yedi küre, renkler 13 renklik
// paletten her açılışta rastgele (tekrarsız), her küre yolunun rastgele bir noktasından ve rastgele yönde
// başlar ("hep kırmızı ve mavi, hep aynı yerden başlıyor"). Albüm / playlist / sanatçı sayfası kendi kapak
// tonunu bildirince küreler söner (`dimmed`), ton saf kalır. Sabit tek katman; yalnızca transform
// animasyonu, bulanıklık gradyandan (filtre yok).

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

/** Uygulama açılışında bir kez seçilir; sayfa geçişlerinde değişmez. */
const STARTS = pickOrbs(Math.random, NAMES.length)

export function AmbientOrbs({ dimmed }: { dimmed: boolean }) {
  return (
    <div className={`ambient-orbs${dimmed ? ' ambient-orbs--dimmed' : ''}`} aria-hidden="true">
      {STARTS.map((orb, i) => (
        <div
          key={NAMES[i]}
          className={`ambient-orb ambient-orb--${NAMES[i]}`}
          style={
            {
              '--orb-color': orb.color,
              animationDelay: `${orb.delaySec}s`,
              animationDirection: orb.reverse ? 'reverse' : 'normal'
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
