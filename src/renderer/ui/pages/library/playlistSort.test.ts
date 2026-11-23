import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAYLIST_SORT,
  directionKey,
  loadPlaylistSort,
  MAX_REMEMBERED,
  savePlaylistSort,
  sortTracks
} from './playlistSort'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data
  }
}

describe('playlist sıralaması hatırlama', () => {
  it('her playlist ayrı; varsayılan saklanmaz; bozuk kayıt varsayılana döner', () => {
    const s = memory()
    expect(loadPlaylistSort('p1', s)).toEqual(DEFAULT_PLAYLIST_SORT)
    savePlaylistSort('p1', { by: 'order', dir: 'desc' }, s)
    savePlaylistSort('p2', { by: 'title', dir: 'asc' }, s)
    expect(loadPlaylistSort('p1', s)).toEqual({ by: 'order', dir: 'desc' })
    expect(loadPlaylistSort('p2', s)).toEqual({ by: 'title', dir: 'asc' })
    savePlaylistSort('p2', DEFAULT_PLAYLIST_SORT, s)
    expect(JSON.parse(s.data.get('am-client.playlistSort')!)).toEqual({
      p1: { by: 'order', dir: 'desc' }
    })
    s.setItem('am-client.playlistSort', '{"p1":{"by":"x","dir":"asc"}}')
    expect(loadPlaylistSort('p1', s)).toEqual(DEFAULT_PLAYLIST_SORT)
    s.setItem('am-client.playlistSort', 'bozuk')
    expect(loadPlaylistSort('p1', s)).toEqual(DEFAULT_PLAYLIST_SORT)
  })

  it('sınır aşılınca en eski kayıt düşer', () => {
    const s = memory()
    for (let i = 0; i <= MAX_REMEMBERED; i++) {
      savePlaylistSort(`p${i}`, { by: 'title', dir: 'asc' }, s)
    }
    expect(loadPlaylistSort('p0', s)).toEqual(DEFAULT_PLAYLIST_SORT)
    expect(loadPlaylistSort(`p${MAX_REMEMBERED}`, s)).toEqual({ by: 'title', dir: 'asc' })
  })

  it('yön adı alana göre', () => {
    expect(directionKey('order', 'desc')).toBe('sort.newestFirst')
    expect(directionKey('duration', 'asc')).toBe('sort.shortestFirst')
    expect(directionKey('artist', 'desc')).toBe('sort.zToA')
  })
})

describe('bellekteki liste sıralaması', () => {
  const t = (id: string, name: string, artistName: string, durationMs: number) => ({
    id,
    name,
    artistName,
    albumName: 'X',
    durationMs,
    playParams: null,
    artworkUrl: null
  })
  const list = [
    t('a', 'beta', 'Zed', 200),
    t('b', 'Alpha', 'adam', 100),
    t('c', 'gamma', 'Adam', 300)
  ]
  const ids = (l: { id: string }[]) => l.map((x) => x.id)

  it('worker ile aynı anlam: ters sıra, harf duyarsız ad, süre; eşitlikte liste sırası', () => {
    expect(ids(sortTracks(list, { by: 'order', dir: 'asc' }))).toEqual(['a', 'b', 'c'])
    expect(ids(sortTracks(list, { by: 'order', dir: 'desc' }))).toEqual(['c', 'b', 'a'])
    expect(ids(sortTracks(list, { by: 'title', dir: 'asc' }))).toEqual(['b', 'a', 'c'])
    expect(ids(sortTracks(list, { by: 'artist', dir: 'asc' }))).toEqual(['b', 'c', 'a'])
    expect(ids(sortTracks(list, { by: 'duration', dir: 'desc' }))).toEqual(['c', 'a', 'b'])
  })
})
