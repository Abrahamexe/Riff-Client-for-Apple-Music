// Kapaksız sayfaların (Ana Sayfa, kütüphane, arama…) arka planı: koyu zeminde yavaş süzülen üç renk
// küresi (geliştirici isteği 2026-10-21: "arka plan sıkıcı, düz"). Renkler sabit uygulama renkleridir
// (kapaktan değil: ana sayfada onlarca kapak var, tek bir kapağı seçmek tutarsız kalıyordu). Albüm /
// playlist / sanatçı sayfası kendi kapak tonunu bildirince küreler söner (`dimmed`), ton saf kalır.
// Sabit tek katman; yalnızca transform / opacity animasyonu, bulanıklık gradyandan (filtre yok).

export function AmbientOrbs({ dimmed }: { dimmed: boolean }) {
  return (
    <div className={`ambient-orbs${dimmed ? ' ambient-orbs--dimmed' : ''}`} aria-hidden="true">
      <div className="ambient-orb ambient-orb--a" />
      <div className="ambient-orb ambient-orb--b" />
      <div className="ambient-orb ambient-orb--c" />
    </div>
  )
}
