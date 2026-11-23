// Apple Music paylaşım bağlantısı (şarkı / albüm / liste menüsü "Bağlantıyı Kopyala"). Yalnızca katalog
// öğelerinin herkese açık bağlantısı olur; arşiv kimlikleri (`i.`, `l.`, `p.`, `r.`) kişiseldir → `null`.
// Biçim main'de de doğrulanır (shared/ipc-contract.ts APPLE_MUSIC_LINK).

export type LinkKind = 'song' | 'album' | 'playlist' | 'artist' | 'station'

const LIBRARY_PREFIX = /^(i|l|p|r)\./
const SAFE_ID = /^[A-Za-z0-9.-]{1,64}$/

export function appleMusicLink(storefront: string, kind: LinkKind, id: string): string | null {
  if (!/^[a-z]{2}$/.test(storefront) || LIBRARY_PREFIX.test(id) || !SAFE_ID.test(id)) return null
  return `https://music.apple.com/${storefront}/${kind}/${id}`
}
