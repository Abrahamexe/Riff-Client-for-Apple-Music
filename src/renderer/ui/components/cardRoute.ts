import type { Card } from '@shared/ipc-contract'
import type { Route } from '../shell/router'

// Kartın açtığı sayfa (B4): albüm, çalma listesi, sanatçı. İstasyon ve şarkının sayfası yok
// (basınca çalar) → `null`.

export function cardRoute(c: Card): Route | null {
  switch (c.kind) {
    case 'album':
      return { name: 'album', id: c.id, title: c.name, artworkUrl: c.artworkUrl }
    case 'playlist':
      return { name: 'playlist', id: c.id, title: c.name, artworkUrl: c.artworkUrl }
    case 'artist':
      return { name: 'artist', id: c.id, title: c.name }
    default:
      return null
  }
}
