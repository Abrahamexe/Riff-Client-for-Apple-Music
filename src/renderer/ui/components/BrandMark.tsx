// Riff Client işareti (logo 5D "ses ızgarası", geliştirici seçimi 2026-11-27): 5 × 5 kare ızgarada yanan
// sütunlar sesi çizer, en yüksek nokta sinyal turuncusu. Uygulama ikonunun (build/icon.svg) arayüzdeki
// sade hâli: döşeme yok, renk temadan (`currentColor`), vurgu sabit marka rengi (kapak renginden bağımsız).

const HEIGHTS = [2, 4, 5, 3, 1] as const
/** Marka rengi: sinyal turuncusu (build/icon.svg ile aynı). */
export const BRAND_ACCENT = '#ff5a1f'

export function BrandMark({ size = 18 }: { size?: number }) {
  const cells = []
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 5; r++) {
      const lit = r >= 5 - HEIGHTS[c]!
      const peak = c === 2 && r === 0
      cells.push(
        <rect
          key={`${c}-${r}`}
          x={c * 14}
          y={r * 14}
          width={10}
          height={10}
          fill={peak ? BRAND_ACCENT : 'currentColor'}
          opacity={peak || lit ? 1 : 0.16}
        />
      )
    }
  }
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 66 66"
      aria-hidden="true"
      focusable="false"
    >
      {cells}
    </svg>
  )
}
