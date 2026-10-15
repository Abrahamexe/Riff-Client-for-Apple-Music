import type { Playlist, Track } from '@shared/ipc-contract'

// Worker testleri için ortak yardımcılar (üretim koduna import edilmez).

export const playlist = (id: string, over: Partial<Playlist> = {}): Playlist => ({
  id,
  name: `Liste ${id}`,
  description: '',
  canEdit: false,
  artworkUrl: null,
  ...over
})

export const track = (id: string, over: Partial<Track> = {}): Track => ({
  id,
  name: `Şarkı ${id}`,
  artistName: 'Sanatçı',
  albumName: 'Albüm',
  durationMs: 180_000,
  playParams: { id, kind: 'song', catalogId: `c${id}` },
  artworkUrl: 'https://is1-ssl.mzstatic.com/x/300x300.jpg',
  ...over
})

/** Apple API'nin döndürdüğü ham kaynak. */
export const songResource = (id: string) => ({
  id,
  type: 'library-songs',
  attributes: {
    name: `Şarkı ${id}`,
    artistName: 'Sanatçı',
    albumName: 'Albüm',
    durationInMillis: 180_000,
    playParams: { id, kind: 'song', catalogId: `c${id}` },
    artwork: { url: 'https://is1-ssl.mzstatic.com/x/{w}x{h}.jpg' }
  }
})

export const playlistResource = (id: string, name = `Liste ${id}`) => ({
  id,
  type: 'library-playlists',
  attributes: { name, canEdit: false, description: { standard: '' } }
})

export interface RecordedRequest {
  url: URL
  headers: Record<string, string>
}

// `unknown` Response/Error'ı da kapsar; ayrım çalışma zamanında `instanceof` ile yapılır.
type Reply = unknown

/**
 * Sahte Apple API: `route(url)` her istek için gövde (JSON'a çevrilir), hazır Response veya
 * fırlatılacak Error döner. Yapılan istekler kaydedilir.
 */
export function fakeFetch(route: (url: URL) => Reply) {
  const requests: RecordedRequest[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
    const reply = route(url)
    if (reply instanceof Error) throw reply
    if (reply instanceof Response) return reply
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

/** Sayfalı yanıt üretir (Apple: `limit` + `offset`, sonraki sayfa varsa `next`). */
export function paged(url: URL, all: readonly unknown[]) {
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? 100)
  const data = all.slice(offset, offset + limit)
  return {
    data,
    ...(offset + limit < all.length ? { next: `${url.pathname}?offset=${offset + limit}` } : {})
  }
}
