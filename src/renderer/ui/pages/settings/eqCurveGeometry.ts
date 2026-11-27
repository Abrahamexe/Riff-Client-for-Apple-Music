// Gözlemevi ekolayzır eğrisi (2026-11-27): bant kazançlarından frekans yanıtı çizgisi. Saf hesap
// (testli); çizim EqCurve.tsx. Eğri bant noktalarından geçen yumuşak bir çizgidir (Catmull-Rom →
// kübik Bézier): ölçülmüş yanıt değil, ayarın görsel özeti.

export interface CurvePoint {
  x: number
  y: number
}

export interface EqCurveGeometry {
  points: CurvePoint[]
  /** Noktalardan geçen çizgi. */
  line: string
  /** Çizgi ile 0 dB arası (dolgu). */
  area: string
  /** 0 dB çizgisinin y'si. */
  zeroY: number
}

/**
 * `columns` sütunlu ızgarada bantlar `firstColumn`'dan başlar (ön kazanç ilk sütunda): eğri
 * kaydırıcıların altına hizalanır. `pad`: üst / alt iç boşluk.
 */
export function eqCurve(
  bands: readonly number[],
  {
    width,
    height,
    maxDb,
    columns,
    firstColumn = 0,
    pad = 10
  }: {
    width: number
    height: number
    maxDb: number
    columns: number
    firstColumn?: number
    pad?: number
  }
): EqCurveGeometry {
  const zeroY = height / 2
  const span = height / 2 - pad
  const clamp = (db: number): number =>
    Math.max(-maxDb, Math.min(maxDb, Number.isFinite(db) ? db : 0))
  const points = bands.map((db, i) => ({
    x: r(((firstColumn + i + 0.5) / columns) * width),
    y: r(zeroY - (clamp(db) / maxDb) * span)
  }))
  if (points.length === 0) return { points, line: '', area: '', zeroY }
  let line = `M${points[0]!.x},${points[0]!.y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    const c1 = { x: r(p1.x + (p2.x - p0.x) / 6), y: r(p1.y + (p2.y - p0.y) / 6) }
    const c2 = { x: r(p2.x - (p3.x - p1.x) / 6), y: r(p2.y - (p3.y - p1.y) / 6) }
    line += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  const area = `${line} L${last.x},${zeroY} L${first.x},${zeroY} Z`
  return { points, line, area, zeroY }
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}
