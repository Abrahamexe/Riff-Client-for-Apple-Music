import { describe, expect, it } from 'vitest'
import { eqCurve } from './eqCurveGeometry'

const OPTS = { width: 1100, height: 200, maxDb: 12, columns: 11, firstColumn: 1, pad: 10 }

describe('Gözlemevi ekolayzır eğrisi (2026-11-27)', () => {
  it('düz ayar: tüm noktalar 0 dB çizgisinde, dolgu sıfır yükseklikte', () => {
    const g = eqCurve(Array(10).fill(0), OPTS)
    expect(g.points).toHaveLength(10)
    expect(g.points.every((p) => p.y === g.zeroY)).toBe(true)
    expect(g.zeroY).toBe(100)
  })

  it('bantlar ön kazanç sütunundan sonra, sütun ortalarına hizalı', () => {
    const g = eqCurve(Array(10).fill(0), OPTS)
    expect(g.points[0]!.x).toBe(150)
    expect(g.points[9]!.x).toBe(1050)
  })

  it('artı kazanç yukarı, eksi aşağı; sınır dışı kırpılır, geçersiz değer 0 sayılır', () => {
    const g = eqCurve([12, -12, 24, Number.NaN], { ...OPTS, columns: 4, firstColumn: 0 })
    expect(g.points[0]!.y).toBe(10)
    expect(g.points[1]!.y).toBe(190)
    expect(g.points[2]!.y).toBe(10)
    expect(g.points[3]!.y).toBe(100)
  })

  it('çizgi ilk noktadan başlar, her bant için bir eğri parçası; dolgu kapalı', () => {
    const g = eqCurve([5, 4, 2, 0, -2, -2, 0, 2, 4, 5], OPTS)
    expect(g.line.startsWith(`M${g.points[0]!.x},${g.points[0]!.y}`)).toBe(true)
    expect(g.line.match(/C/g)).toHaveLength(9)
    expect(g.area.endsWith('Z')).toBe(true)
  })

  it('bant yoksa boş', () => {
    expect(eqCurve([], OPTS)).toMatchObject({ points: [], line: '', area: '' })
  })
})
