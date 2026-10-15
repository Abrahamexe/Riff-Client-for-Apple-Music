import { describe, expect, it } from 'vitest'
import type { Card, SearchSuggestions } from '@shared/ipc-contract'
import { menuItems, moveFocus } from './searchMenu'

const card = (id: string): Card => ({
  kind: 'album',
  id,
  name: id,
  subtitle: '',
  artworkUrl: null,
  playParams: null
})
const suggestions = (term: string, terms: string[], top: string[]): SearchSuggestions => ({
  term,
  terms: terms.map((t) => ({ searchTerm: t, displayTerm: t })),
  top: top.map(card)
})

describe('arama açılır listesi (B7)', () => {
  it('boş kutu: son aramalar (en fazla 8)', () => {
    const recents = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const items = menuItems('  ', recents, null)
    expect(items).toHaveLength(8)
    expect(items[0]).toEqual({ kind: 'recent', term: 't0' })
  })

  it('yazarken: terimler (en fazla 5) sonra en iyi eşleşmeler (en fazla 4)', () => {
    const s = suggestions('que', ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], ['a', 'b', 'c', 'd', 'e'])
    const items = menuItems('que ', [], s)
    expect(items.map((i) => i.kind)).toEqual([
      'term',
      'term',
      'term',
      'term',
      'term',
      'top',
      'top',
      'top',
      'top'
    ])
  })

  it('eski terimin önerisi gösterilmez', () => {
    expect(menuItems('queen', ['x'], suggestions('que', ['q'], []))).toEqual([])
    expect(menuItems('queen', ['x'], null)).toEqual([])
  })

  it('ok tuşları: kutu (-1) ↔ öğeler arasında döner', () => {
    expect(moveFocus(-1, 1, 3)).toBe(0)
    expect(moveFocus(2, 1, 3)).toBe(-1)
    expect(moveFocus(-1, -1, 3)).toBe(2)
    expect(moveFocus(0, -1, 3)).toBe(-1)
    expect(moveFocus(-1, 1, 0)).toBe(-1)
  })
})
