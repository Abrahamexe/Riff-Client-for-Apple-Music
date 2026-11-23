import { describe, expect, it } from 'vitest'
import { CardSchema, type SearchGroups } from '@shared/ipc-contract'
import { albumCard, artistCard, isEmptyResult, playlistCard, resultShelves } from './searchCards'

const empty: SearchGroups = {
  top: [],
  songs: [],
  albums: [],
  artists: [],
  playlists: [],
  stations: []
}

describe('arama sonuç rafları (B7)', () => {
  it('kartlar sözleşmeye uyar', () => {
    const cards = [
      albumCard({
        id: 'l.1',
        name: 'A',
        artistName: 'Queen',
        trackCount: 1,
        playParams: null,
        artworkUrl: null,
        explicit: true
      }),
      artistCard({ id: 'r.1', name: 'Queen', artworkUrl: null }),
      playlistCard({ id: 'p.1', name: 'L', description: '', canEdit: true, artworkUrl: null })
    ]
    for (const c of cards) expect(CardSchema.safeParse(c).success).toBe(true)
    expect(cards.map((c) => `${c.kind}:${c.subtitle}`)).toEqual([
      'album:Queen',
      'artist:',
      'playlist:'
    ])
    expect(cards[0]!.explicit).toBe(true)
  })

  it('Apple Music sırası; boş raflar atlanır; boş sonuç', () => {
    expect(isEmptyResult(empty)).toBe(true)
    const g: SearchGroups = {
      ...empty,
      stations: [
        { kind: 'station', id: 'ra.1', name: 'S', subtitle: '', artworkUrl: null, playParams: null }
      ],
      artists: [{ id: '1', name: 'Queen', artworkUrl: null }]
    }
    expect(resultShelves(g).map((s) => s.id)).toEqual(['artists', 'stations'])
    expect(isEmptyResult(g)).toBe(false)
  })
})
