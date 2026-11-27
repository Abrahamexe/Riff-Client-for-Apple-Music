import { EQ_MAX_DB } from '@shared/settings'
import { eqCurve } from './eqCurveGeometry'

// Gözlemevi ekolayzırı (2026-11-27): kaydırıcıların üstünde frekans yanıtı eğrisi. Kaydırıcılarla
// aynı ızgara (`.eq-curve-row`, observatory.css): ön kazanç sütununda dB ölçeği, eğri 10 bant
// sütununun üstünde. Yalnızca görsel; değer kaydırıcılarda.

const W = 1000
const H = 170
const COLUMNS = 10
const PAD = 10
const GRID_DB = [12, 6, 0, -6, -12] as const

export function EqCurve({ bands }: { bands: readonly number[] }) {
  const g = eqCurve(bands, { width: W, height: H, maxDb: EQ_MAX_DB, columns: COLUMNS, pad: PAD })
  const span = H / 2 - PAD
  const yOf = (db: number): number => g.zeroY - (db / EQ_MAX_DB) * span
  const peak = bands.reduce<number>(
    (best, db, i) => (Math.abs(db) > Math.abs(bands[best] ?? 0) ? i : best),
    0
  )
  return (
    <div className="eq-curve-row">
      <svg className="eq-curve" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {GRID_DB.filter((db) => Math.abs(db) <= EQ_MAX_DB).map((db) => (
          <g key={db}>
            <line
              className={db === 0 ? 'eq-curve__zero' : 'eq-curve__grid'}
              x1={0}
              x2={W}
              y1={yOf(db)}
              y2={yOf(db)}
            />
            <text className="eq-curve__label" x={-14} y={yOf(db) + 3} textAnchor="end">
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        {g.points.map((p) => (
          <line key={p.x} className="eq-curve__band" x1={p.x} x2={p.x} y1={4} y2={H - 4} />
        ))}
        <path className="eq-curve__area" d={g.area} />
        <path className="eq-curve__line" d={g.line} />
        {g.points.map((p, i) => (
          <circle key={p.x} className="eq-curve__dot" cx={p.x} cy={p.y} r={i === peak ? 4.5 : 3} />
        ))}
      </svg>
    </div>
  )
}
