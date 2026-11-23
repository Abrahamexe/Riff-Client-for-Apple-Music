import type { Album, Artist, Card, Playlist, SearchGroups } from '@shared/ipc-contract'

// Arama sonuçları → raf kartları (B7; saf, testli). Apple Music sırası: En İyi Sonuçlar, Şarkılar,
// Sanatçılar, Albümler, Çalma Listeleri, İstasyonlar.

export const albumCard = (a: Album): Card => ({
  kind: 'album',
  id: a.id,
  name: a.name,
  subtitle: a.artistName,
  artworkUrl: a.artworkUrl,
  playParams: a.playParams,
  ...(a.explicit ? { explicit: true } : {})
})

export const artistCard = (a: Artist): Card => ({
  kind: 'artist',
  id: a.id,
  name: a.name,
  subtitle: '',
  artworkUrl: a.artworkUrl,
  playParams: null
})

export const playlistCard = (p: Playlist): Card => ({
  kind: 'playlist',
  id: p.id,
  name: p.name,
  subtitle: '',
  artworkUrl: p.artworkUrl,
  playParams: null
})

export type ResultShelf = 'top' | 'artists' | 'albums' | 'playlists' | 'stations'

/** Şarkılar dışındaki raflar, Apple Music sırasıyla; boş raflar atlanır. */
export function resultShelves(g: SearchGroups): { id: ResultShelf; cards: Card[] }[] {
  const shelves: { id: ResultShelf; cards: Card[] }[] = [
    { id: 'top', cards: g.top },
    { id: 'artists', cards: g.artists.map(artistCard) },
    { id: 'albums', cards: g.albums.map(albumCard) },
    { id: 'playlists', cards: g.playlists.map(playlistCard) },
    { id: 'stations', cards: g.stations }
  ]
  return shelves.filter((s) => s.cards.length > 0)
}

/** Hiç sonuç yok mu. */
export const isEmptyResult = (g: SearchGroups): boolean =>
  g.songs.length === 0 && resultShelves(g).length === 0
