import type { Card, SearchSuggestions } from '@shared/ipc-contract'

// Arama açılır listesi (B7; geliştirici kararı: Apple Music gibi): boşken son aramalar, yazarken
// Apple'ın önerdiği terimler + kapaklı en iyi eşleşmeler. Saf yardımcılar (testli).

export type MenuItem =
  | { kind: 'recent'; term: string }
  | { kind: 'term'; term: string; label: string }
  | { kind: 'top'; card: Card }

const MAX_RECENT_ITEMS = 8
const MAX_TERM_ITEMS = 5
const MAX_TOP_ITEMS = 4

/**
 * Gösterilecek öğeler. Öneriler yalnızca kutudaki terimle eşleşiyorsa kullanılır (geç gelen eski
 * terimin önerisi gösterilmez).
 */
export function menuItems(
  term: string,
  recents: readonly string[],
  suggestions: SearchSuggestions | null
): MenuItem[] {
  const q = term.trim()
  if (q === '') {
    return recents.slice(0, MAX_RECENT_ITEMS).map((t) => ({ kind: 'recent', term: t }))
  }
  if (!suggestions || suggestions.term !== q) return []
  return [
    ...suggestions.terms
      .slice(0, MAX_TERM_ITEMS)
      .map((t): MenuItem => ({ kind: 'term', term: t.searchTerm, label: t.displayTerm })),
    ...suggestions.top.slice(0, MAX_TOP_ITEMS).map((card): MenuItem => ({ kind: 'top', card }))
  ]
}

/** Ok tuşlarıyla odak: -1 = hiçbiri (Enter kutudaki terimi arar); uçlarda kutuya döner. */
export function moveFocus(index: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1
  const next = index + delta
  if (next < -1) return count - 1
  if (next >= count) return -1
  return next
}
