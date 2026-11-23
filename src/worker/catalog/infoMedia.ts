import type { Artist, Track } from '@shared/ipc-contract'

// Bilgi paneli görselleri (§3.5 geri bildirimi 2026-10-14: "kişilerin profil fotoğrafları", "sample'ın
// albüm kapağı, sanatçısı"). MusicBrainz'de görsel yok; adlar Apple Music kataloğunda aranır ve
// YALNIZCA güvenli eşleşme kabul edilir (yanlış kişinin fotoğrafı, eşleşmemesinden kötüdür):
//  - sanatçı: ad birebir (büyük/küçük harf, aksan ve noktalama farkı gözetmeden);
//  - şarkı: başlık (parantez / "feat." ekleri atılmış) birebir ve sanatçı adı ana sanatçıyı içeriyor.

/** Karşılaştırma için: küçük harf, aksansız, yalnızca harf ve rakam. */
export function nameKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** "Title (feat. X) [Remastered]" → "Title"; " - Remastered 2011" gibi ekler de atılır. */
export function baseTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim()
}

/** "A, B & C feat. D" → "A" */
export function primaryArtist(name: string): string {
  return (name.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*|\s+(?:with|x)\s+/i)[0] ?? name).trim()
}

export function matchArtist(name: string, candidates: readonly Artist[]): Artist | null {
  const key = nameKey(name)
  if (!key) return null
  return candidates.find((a) => nameKey(a.name) === key) ?? null
}

export function matchSong(
  title: string,
  artist: string,
  candidates: readonly Track[]
): Track | null {
  const t = nameKey(baseTitle(title))
  const a = nameKey(primaryArtist(artist))
  if (!t) return null
  return (
    candidates.find(
      (c) => nameKey(baseTitle(c.name)) === t && (!a || nameKey(c.artistName).includes(a))
    ) ?? null
  )
}
