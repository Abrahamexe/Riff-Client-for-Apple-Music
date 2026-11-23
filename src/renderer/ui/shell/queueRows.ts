import type { NowPlaying } from '@core/musickit/player'

// Sıradaki paneli satırları (§3.2). Anahtar şarkı id'si + aynı id'nin bölümdeki kaçıncı tekrarı:
// taşıma sonrası satır aynı anahtarla kalır (odak ve animasyon korunur); sıra numarası değişir.

export interface QueueEntry {
  key: string
  /** `snapshot().queue` içindeki sıra. */
  index: number
  item: NowPlaying
}

export function queueEntries(items: readonly NowPlaying[], from: number, to: number): QueueEntry[] {
  const seen = new Map<string, number>()
  const out: QueueEntry[] = []
  for (let index = Math.max(0, from); index < Math.min(to, items.length); index++) {
    const item = items[index]!
    const n = seen.get(item.id) ?? 0
    seen.set(item.id, n + 1)
    out.push({ key: `${item.id}#${n}`, index, item })
  }
  return out
}

/**
 * Sürükleme bitince taşınacak sıra: öğenin yeni görünen yerine karşılık gelen kuyruk sırası.
 * Değişiklik yoksa `null`.
 */
export function dropTarget(
  order: readonly QueueEntry[],
  key: string
): { from: number; to: number } | null {
  const at = order.findIndex((e) => e.key === key)
  if (at < 0) return null
  const first = Math.min(...order.map((e) => e.index))
  const from = order[at]!.index
  const to = first + at
  return from === to ? null : { from, to }
}
