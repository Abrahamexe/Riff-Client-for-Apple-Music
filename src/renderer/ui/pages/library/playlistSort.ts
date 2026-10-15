import type { PlaylistSort, Track } from '@shared/ipc-contract'

// Playlist sıralaması (geliştirici kararı 2026-10-14): her playlist kendi sıralamasını hatırlar
// (Apple Music gibi). Yalnızca görünüm; Apple'daki sıra değişmez. Bu bilgisayarda (localStorage).

export const DEFAULT_PLAYLIST_SORT: PlaylistSort = { by: 'order', dir: 'asc' }
const KEY = 'am-client.playlistSort'
/** Saklanan playlist sayısı sınırı (en eskisi düşer). */
export const MAX_REMEMBERED = 500

type Store = Pick<Storage, 'getItem' | 'setItem'>

function readAll(storage: Store): Record<string, PlaylistSort> {
  try {
    const raw: unknown = JSON.parse(storage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, PlaylistSort>) : {}
  } catch {
    return {}
  }
}

const FIELDS: ReadonlySet<string> = new Set(['order', 'title', 'artist', 'album', 'duration'])

export function isDefaultSort(sort: PlaylistSort): boolean {
  return sort.by === 'order' && sort.dir === 'asc'
}

export function loadPlaylistSort(id: string, storage: Store): PlaylistSort {
  const s = readAll(storage)[id]
  return s && FIELDS.has(s.by) && (s.dir === 'asc' || s.dir === 'desc') ? s : DEFAULT_PLAYLIST_SORT
}

export function savePlaylistSort(id: string, sort: PlaylistSort, storage: Store): void {
  const all = readAll(storage)
  delete all[id]
  if (!isDefaultSort(sort)) all[id] = sort
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k]
  try {
    storage.setItem(KEY, JSON.stringify(all))
  } catch {
    // yalnızca bu oturumda geçerli
  }
}

type FieldKey = 'sort.playlistOrder' | 'sort.title' | 'sort.artist' | 'sort.album' | 'sort.duration'
type DirectionKey =
  | 'sort.oldestFirst'
  | 'sort.newestFirst'
  | 'sort.shortestFirst'
  | 'sort.longestFirst'
  | 'sort.aToZ'
  | 'sort.zToA'

export const SORT_FIELD_KEYS: Record<PlaylistSort['by'], FieldKey> = {
  order: 'sort.playlistOrder',
  title: 'sort.title',
  artist: 'sort.artist',
  album: 'sort.album',
  duration: 'sort.duration'
}

/** Yönün alana göre okunur adı (ör. sıra: "Yeniden eskiye", süre: "Uzundan kısaya"). */
export function directionKey(by: PlaylistSort['by'], dir: PlaylistSort['dir']): DirectionKey {
  if (by === 'order') return dir === 'asc' ? 'sort.oldestFirst' : 'sort.newestFirst'
  if (by === 'duration') return dir === 'asc' ? 'sort.shortestFirst' : 'sort.longestFirst'
  return dir === 'asc' ? 'sort.aToZ' : 'sort.zToA'
}

const text = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base' })
const COMPARE: Record<PlaylistSort['by'], (a: Track, b: Track) => number> = {
  order: () => 0,
  title: (a, b) => text(a.name, b.name),
  artist: (a, b) => text(a.artistName, b.artistName) || text(a.albumName, b.albumName),
  album: (a, b) => text(a.albumName, b.albumName),
  duration: (a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0)
}

/**
 * Bellekteki liste için (Apple playlist sayfası) aynı sıralama: eşitlikte playlist sırası; yön tüm
 * karşılaştırmaya uygulanır (worker'daki SQL ile aynı anlam).
 */
export function sortTracks<T extends Track>(tracks: readonly T[], sort: PlaylistSort): T[] {
  if (isDefaultSort(sort)) return [...tracks]
  const sign = sort.dir === 'desc' ? -1 : 1
  const cmp = COMPARE[sort.by]
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => sign * (cmp(a.t, b.t) || a.i - b.i))
    .map((x) => x.t)
}
