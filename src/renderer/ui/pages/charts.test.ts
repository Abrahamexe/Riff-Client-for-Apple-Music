import { describe, expect, it } from 'vitest'
import type { Card, CardGroup } from '@shared/ipc-contract'
import { chartKind, isCardPlaying, songId, splitCharts } from './charts'

const group = (id: string): CardGroup => ({ id, title: id, cards: [] })
const song = (id: string, playId?: string): Card => ({
  kind: 'song',
  id,
  name: id,
  subtitle: '',
  artworkUrl: null,
  playParams: playId ? { id: playId, kind: 'song' } : null
})

describe('"Yeni" listeleri (B6)', () => {
  it('sıra: Popüler Listeler → Popüler Parçalar → geri kalanlar Apple sırasıyla', () => {
    const groups = [
      group('songs:most-played'),
      group('albums:most-played'),
      group('playlists:most-played'),
      group('dailyGlobalTopCharts:daily-global-top'),
      group('cityCharts:city-top')
    ]
    const { lead, songs, rest } = splitCharts(groups)
    expect(lead.map((g) => g.id)).toEqual(['playlists:most-played'])
    expect(songs.map((g) => g.id)).toEqual(['songs:most-played'])
    expect(rest.map(chartKind)).toEqual(['albums', 'dailyGlobalTopCharts', 'cityCharts'])
  })

  it('türe göre (liste yok): parçalar ve albümler', () => {
    const { lead, songs, rest } = splitCharts([
      group('songs:most-played'),
      group('albums:most-played')
    ])
    expect(lead).toEqual([])
    expect(songs).toHaveLength(1)
    expect(rest.map(chartKind)).toEqual(['albums'])
  })

  it('çalan şarkı: id ya da katalog id eşleşmesi', () => {
    expect(songId(song('1', '9'))).toBe('9')
    expect(songId(song('1'))).toBe('1')
    expect(isCardPlaying(song('1'), { id: '1' })).toBe(true)
    expect(isCardPlaying(song('1'), { id: 'i.x', catalogId: '1' })).toBe(true)
    expect(isCardPlaying(song('1'), { id: '2' })).toBe(false)
    expect(isCardPlaying(song('1'), null)).toBe(false)
  })
})
