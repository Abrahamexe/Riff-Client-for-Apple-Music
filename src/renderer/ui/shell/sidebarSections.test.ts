import { describe, expect, it } from 'vitest'
import {
  loadCollapsed,
  loadPinned,
  parseCollapsed,
  saveCollapsed,
  savePinned
} from './sidebarSections'

describe('sol menü bölümleri', () => {
  it('kayıt yoksa / bozuksa hepsi açık; bilinmeyen değerler yok sayılır', () => {
    expect([...parseCollapsed(null)]).toEqual([])
    expect([...parseCollapsed('{bozuk')]).toEqual([])
    expect([...parseCollapsed('"playlists"')]).toEqual([])
    expect([...parseCollapsed('["playlists","x",3]')]).toEqual(['playlists'])
  })

  it('kaydedilen durum geri okunur; depo hata verirse sessizce geçer', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v)
    }
    saveCollapsed(new Set(['library']), storage)
    expect([...loadCollapsed(storage)]).toEqual(['library'])
    const broken = {
      getItem: () => {
        throw new Error('engelli')
      },
      setItem: () => {
        throw new Error('engelli')
      }
    }
    expect(() => saveCollapsed(new Set(['library']), broken)).not.toThrow()
    expect([...loadCollapsed(broken)]).toEqual([])
    expect([...loadCollapsed(null)]).toEqual([])
  })
})

describe('menü kilidi', () => {
  it('kaydedilir ve okunur; okunamazsa açık kilit', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v)
    }
    expect(loadPinned(storage)).toBe(false)
    savePinned(true, storage)
    expect(loadPinned(storage)).toBe(true)
    savePinned(false, storage)
    expect(loadPinned(storage)).toBe(false)
    const broken = {
      getItem: (): string => {
        throw new Error('yok')
      }
    }
    expect(loadPinned(broken)).toBe(false)
    expect(loadPinned(null)).toBe(false)
  })
})
