import { describe, expect, it } from 'vitest'
import { SEEK_PENDING_MAX_MS, seekSettled } from './pendingSeek'
import { rangeValueAt } from './pointerRange'

describe('çubukta fare konumu → değer', () => {
  it('çubuğun soldan oranı kadar; kenarlarda kırpılır', () => {
    expect(rangeValueAt(170, 100, 200, 165)).toBeCloseTo(57.75)
    expect(rangeValueAt(240, 100, 200, 1)).toBeCloseTo(0.7)
    expect(rangeValueAt(50, 100, 200, 165)).toBe(0)
    expect(rangeValueAt(999, 100, 200, 165)).toBe(165)
  })

  it('genişlik ya da üst sınır yoksa 0', () => {
    expect(rangeValueAt(150, 100, 0, 165)).toBe(0)
    expect(rangeValueAt(150, 100, 200, 0)).toBe(0)
    expect(rangeValueAt(150, 100, Number.NaN, 165)).toBe(0)
  })
})

describe('sarma sonrası bekleyen konum', () => {
  it('bildirilen konum hedefe yaklaşınca ya da süre dolunca biter', () => {
    expect(seekSettled(117, 4, 100)).toBe(false)
    expect(seekSettled(117, 116.8, 300)).toBe(true)
    expect(seekSettled(117, 4, SEEK_PENDING_MAX_MS + 1)).toBe(true)
  })
})
