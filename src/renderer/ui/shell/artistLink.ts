import type { SongLinks } from '@shared/ipc-contract'
import type { Route } from './router'

// Oynatıcıdaki sanatçı adı (geliştirici isteği, 2026-10-14): basınca çalan şarkının sanatçı sayfası.
//  1. Katalog id'si varsa şarkının ilişkisinden sanatçı (birden çok sanatçıda ilki, ana sanatçı).
//  2. Olmazsa (geliştirici geri bildirimi "profili açılmıyor": bazı şarkılarda Apple `CONTENT_NOT_FOUND`
//     döndü; yüklenmiş şarkıların katalog id'si yok) katalogda ana sanatçının adı aranır; YALNIZCA
//     adı birebir (büyük/küçük harf ve aksan farkı gözetmeden) eşleşen sanatçı açılır.
//  3. Bulunamazsa `false` (çağıran kullanıcıya bildirir).

export interface ArtistLookup {
  getSongLinks(catalogId: string): Promise<SongLinks>
  searchArtists(name: string): Promise<readonly { id: string; name: string }[]>
}

/** "A, B & C feat. D" → "A" */
export function primaryArtist(name: string): string {
  return (name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*|\s+(?:with|x)\s+/i)[0] ?? name).trim()
}

const same = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

export async function openSongArtist(
  track: { catalogId?: string; artist: string },
  lookup: ArtistLookup,
  go: (route: Route) => void
): Promise<boolean> {
  if (track.catalogId) {
    try {
      const links = await lookup.getSongLinks(track.catalogId)
      if (links.artistId) {
        go({ name: 'artist', id: links.artistId, title: links.artistName })
        return true
      }
    } catch {
      // katalogda yok / ağ hatası: adla aramaya geç
    }
  }
  const name = primaryArtist(track.artist)
  if (!name) return false
  try {
    const found = (await lookup.searchArtists(name)).find((a) => same(a.name, name))
    if (!found) return false
    go({ name: 'artist', id: found.id, title: found.name })
    return true
  } catch {
    return false
  }
}
