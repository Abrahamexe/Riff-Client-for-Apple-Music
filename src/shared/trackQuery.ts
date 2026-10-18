// Playlist içinde arama (geliştirici isteği 2026-10-18: "playlistlere şarkı aramak için arama
// çubuğu"). Worker (kütüphane playlist'leri, SQLite'tan) ve renderer (Apple playlist'leri, bellekte)
// aynı kuralı kullanır: şarkı adı + sanatçı + albüm içinde, büyük/küçük harf ve aksan duyarsız
// (ı/i, ş/s, é/e), sorgunun HER kelimesi geçmeli (sıra önemsiz).

/** Arama kutusundaki en uzun sorgu (IPC şeması da bunu kullanır). */
export const TRACK_QUERY_MAX = 200

/** Karşılaştırma biçimi: küçük harf, aksansız, noktalama yerine boşluk. */
export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Sorgu kelimeleri (katlanmış); boş sorguda boş dizi. */
export function queryTerms(query: string): string[] {
  return foldText(query.slice(0, TRACK_QUERY_MAX))
    .split(' ')
    .filter((t) => t !== '')
}

export interface QueryableTrack {
  name: string
  artistName: string
  albumName: string
}

/** `terms` boşsa her şarkı eşleşir. */
export function trackMatches(track: QueryableTrack, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = ` ${foldText(`${track.name} ${track.artistName} ${track.albumName}`)}`
  return terms.every((t) => haystack.includes(t))
}

/** Sorguya uyan şarkılar (sıra korunur). */
export function filterTracks<T extends QueryableTrack>(tracks: readonly T[], query: string): T[] {
  const terms = queryTerms(query)
  return terms.length === 0 ? [...tracks] : tracks.filter((t) => trackMatches(t, terms))
}
