import { cachedArtworkUrl } from '@core/data/artwork'
import type { LibraryClient } from '@core/data/library'

// Büyük oynatıcının sanatçı fotoğrafı (sanatçı modu). Şarkı → katalog bağlantıları → sanatçı → 1600 px
// görsel: yavaş DNS'te üç istek + indirme saniyeler sürüyordu (geliştirici 2026-10-18: "sanatçı
// fotoğrafları geç açılıyor"). Artık: aynı şarkı için tek istek (süren söz birleşir), görsel İNDİRİLİP
// ÇÖZÜLDÜKTEN sonra hazır sayılır (açılınca boş solma olmaz), büyük oynatıcı açıkken çalan ve sıradaki
// şarkı için mod kapalıyken de önden istenir; alt oynatıcıdaki kapağın üzerine gelince de.

type Lookup = Pick<LibraryClient, 'getSongLinks' | 'getArtist' | 'lookupInfoMedia'>

export interface ArtistImageTrack {
  catalogId?: string | undefined
  artist: string
}

const CACHE_MAX = 200
const pending = new Map<string, Promise<string | null>>()
/** Hazır (indirilmiş, çözülmüş) sonuçlar: modu açınca anında gösterilir. */
const ready = new Map<string, string | null>()

export const artistImageKey = (t: ArtistImageTrack): string => t.catalogId ?? `name:${t.artist}`

/** Hazırsa sonuç (`null` = görsel yok); henüz yoksa `undefined`. */
export function readyArtistImage(t: ArtistImageTrack): string | null | undefined {
  return ready.get(artistImageKey(t))
}

async function decoded(url: string): Promise<void> {
  if (typeof Image === 'undefined') return
  const img = new Image()
  img.src = url
  await img.decode().catch(() => {})
}

async function resolve(library: Lookup, t: ArtistImageTrack): Promise<string | null> {
  const detail = t.catalogId
    ? await library
        .getSongLinks(t.catalogId)
        .then((l) => (l.artistId ? library.getArtist(l.artistId) : null))
    : null
  const raw =
    detail?.artist.artworkUrl ??
    (await library.lookupInfoMedia([t.artist], [])).artists[0]?.artworkUrl ??
    null
  const url = cachedArtworkUrl(raw, 1600)
  if (url) await decoded(url)
  return url
}

/** Sanatçı görseli; aynı şarkı için süren istek paylaşılır. Hata `null` döner ve sonra yeniden denenir. */
export function artistImage(library: Lookup, t: ArtistImageTrack): Promise<string | null> {
  const key = artistImageKey(t)
  if (ready.has(key)) return Promise.resolve(ready.get(key) ?? null)
  let p = pending.get(key)
  if (!p) {
    p = resolve(library, t).then(
      (url) => {
        if (ready.size >= CACHE_MAX) ready.clear()
        ready.set(key, url)
        pending.delete(key)
        return url
      },
      () => {
        pending.delete(key)
        return null
      }
    )
    pending.set(key, p)
  }
  return p
}

/** Önden hazırla (sonuç beklenmez). */
export function prefetchArtistImage(library: Lookup, t: ArtistImageTrack | null | undefined): void {
  if (t && t.artist.trim() !== '') void artistImage(library, t)
}
