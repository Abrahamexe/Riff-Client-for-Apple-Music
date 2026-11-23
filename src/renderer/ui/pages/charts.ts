import type { Card, CardGroup } from '@shared/ipc-contract'

// "Yeni" sayfasının saf yardımcıları (B6; testli).

/** Apple'ın liste kimliğindeki tür (`songs:most-played` → `songs`). */
export const chartKind = (g: CardGroup): string => g.id.split(':')[0] ?? ''

/**
 * Sayfa sırası (geliştirici kararı, Apple Music gibi): Popüler Listeler büyük kartlarla en üstte,
 * sonra Popüler Parçalar (numaralı sütunlar), sonra geri kalanlar Apple'ın sırasıyla (albümler,
 * Günlük Top 100, Şehir Listeleri).
 */
export function splitCharts(groups: readonly CardGroup[]): {
  lead: CardGroup[]
  songs: CardGroup[]
  rest: CardGroup[]
} {
  const lead = groups.filter((g) => chartKind(g) === 'playlists')
  const songs = groups.filter((g) => chartKind(g) === 'songs')
  const rest = groups.filter((g) => chartKind(g) !== 'playlists' && chartKind(g) !== 'songs')
  return { lead, songs, rest }
}

/** Şarkı kartının çalınacak katalog id'si. */
export const songId = (c: Card): string => c.playParams?.id ?? c.id

/** Çalan şarkı bu kart mı (kütüphane kopyası çalıyorsa katalog id'siyle). */
export function isCardPlaying(
  c: Card,
  current: { id: string; catalogId?: string } | null
): boolean {
  if (!current) return false
  const id = songId(c)
  return current.id === id || current.catalogId === id
}
