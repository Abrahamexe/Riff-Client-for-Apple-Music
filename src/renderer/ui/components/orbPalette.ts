// Arka plan kürelerinin renk ve başlangıç seçimi (2026-11-02, geliştirici: "her açılışta farklı renkte ve
// farklı yerden başlasın, hep kırmızı ve mavi başlıyor; bir sürü renk olsun"). Saf: rastgele kaynağı
// verilebilir (testli). Uygulama her açılışta bir kez seçer.

/** Canlı renkler (RGB üçlüsü, CSS `rgb(var(--orb-color) / a)` için). */
export const ORB_PALETTE: readonly string[] = [
  '250 45 72', // kırmızı
  '255 55 160', // pembe
  '200 60 255', // eflatun
  '124 82 255', // mor
  '80 90 255', // çivit
  '40 120 255', // mavi
  '30 190 255', // gök mavisi
  '20 200 190', // turkuaz
  '50 210 120', // yeşil
  '170 220 40', // fıstık yeşili
  '255 200 40', // sarı
  '255 138 40', // turuncu
  '255 100 80' // mercan
]

/** Küre sayısı (shell.css `.ambient-orb--a` … `--g`). */
export const ORB_COUNT = 7

export interface OrbStart {
  /** RGB üçlüsü. */
  color: string
  /** Negatif animasyon gecikmesi (sn): küre yolunun rastgele bir noktasından başlar. */
  delaySec: number
  /** Yolu ters yönde dolaşır. */
  reverse: boolean
}

/** En uzun döngüden (16 sn) uzun: gecikme yolun her noktasına düşebilsin. */
const MAX_PHASE_SEC = 20

/** Paletten birbirinden farklı `count` renk (karıştırılmış) ve her küre için rastgele başlangıç. */
export function pickOrbs(random: () => number = Math.random, count = ORB_COUNT): OrbStart[] {
  const colors = [...ORB_PALETTE]
  // Fisher–Yates: renkler tekrarlanmaz, sıra her açılışta farklı.
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[colors[i], colors[j]] = [colors[j]!, colors[i]!]
  }
  return Array.from({ length: Math.min(count, colors.length) }, (_, i) => ({
    color: colors[i]!,
    delaySec: -Math.round(random() * MAX_PHASE_SEC * 10) / 10,
    reverse: random() < 0.5
  }))
}
