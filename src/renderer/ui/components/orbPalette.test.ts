import { describe, expect, it } from 'vitest'
import { ORB_COUNT, ORB_PALETTE, pickOrbs } from './orbPalette'

/** Tekrarlanabilir rastgele kaynak (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('pickOrbs', () => {
  it('paletten tekrarsız ORB_COUNT renk seçer', () => {
    const orbs = pickOrbs(seeded(1))
    expect(orbs).toHaveLength(ORB_COUNT)
    expect(new Set(orbs.map((o) => o.color)).size).toBe(ORB_COUNT)
    for (const o of orbs) expect(ORB_PALETTE).toContain(o.color)
  })

  it('palet "bir sürü renk": seçilenden çok daha fazla; hepsi geçerli RGB üçlüsü', () => {
    expect(ORB_PALETTE.length).toBeGreaterThanOrEqual(12)
    expect(new Set(ORB_PALETTE).size).toBe(ORB_PALETTE.length)
    for (const c of ORB_PALETTE) {
      const parts = c.split(' ').map(Number)
      expect(parts).toHaveLength(3)
      for (const v of parts) expect(v >= 0 && v <= 255).toBe(true)
    }
  })

  it('farklı açılışlar farklı renk ve başlangıç verir (hep kırmızı-mavi değil)', () => {
    const firsts = new Set<string>()
    const delays = new Set<number>()
    for (let seed = 1; seed <= 40; seed++) {
      const [first] = pickOrbs(seeded(seed))
      firsts.add(first!.color)
      delays.add(first!.delaySec)
    }
    expect(firsts.size).toBeGreaterThan(6)
    expect(delays.size).toBeGreaterThan(20)
  })

  it('başlangıç yolun içinde (negatif gecikme, en fazla 20 sn); iki yön de çıkar', () => {
    const all = Array.from({ length: 30 }, (_, i) => pickOrbs(seeded(i + 100))).flat()
    for (const o of all) {
      expect(o.delaySec).toBeLessThanOrEqual(0)
      expect(o.delaySec).toBeGreaterThanOrEqual(-20)
    }
    expect(new Set(all.map((o) => o.reverse)).size).toBe(2)
  })
})
