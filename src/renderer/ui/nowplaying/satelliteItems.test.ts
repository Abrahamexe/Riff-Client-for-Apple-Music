import { describe, expect, it } from 'vitest'
import { satelliteItems } from './satelliteItems'

describe('Gözlemevi uyduları (2026-11-27)', () => {
  const items = ['a', 'b', 'c', 'd']

  it('çalandan sonraki iki şarkı, kuyruk sıralarıyla', () => {
    expect(satelliteItems(items, 1)).toEqual([
      { item: 'c', index: 2 },
      { item: 'd', index: 3 }
    ])
  })

  it('kuyruğun sonunda daha az ya da hiç uydu yok', () => {
    expect(satelliteItems(items, 2)).toEqual([{ item: 'd', index: 3 }])
    expect(satelliteItems(items, 3)).toEqual([])
    expect(satelliteItems([], 0)).toEqual([])
  })

  it('geçersiz konum baştan sayılır; sayı sınırı uyulur', () => {
    expect(satelliteItems(items, -1)).toEqual([
      { item: 'b', index: 1 },
      { item: 'c', index: 2 }
    ])
    expect(satelliteItems(items, Number.NaN, 1)).toEqual([{ item: 'b', index: 1 }])
  })
})
