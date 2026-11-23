import type { Locale } from '@shared/i18n'
import type { Track } from '@shared/ipc-contract'

// Sayfa bilgi satırları (B5, saf): yayın yılı / tarihi, toplam süre, ses türü rozetleri, disk grupları.

const INTL_LOCALE: Record<Locale, string> = { tr: 'tr-TR', en: 'en-US' }

/** Apple `releaseDate` (`YYYY`, `YYYY-MM` veya `YYYY-MM-DD`) → yıl; geçersizse `null`. */
export function releaseYear(date: string | null | undefined): string | null {
  const m = date ? /^(\d{4})/.exec(date) : null
  return m ? m[1]! : null
}

/** Tam tarih uzun biçimde ("20 Mayıs 2013"); yalnızca yıl/ay varsa yıl. */
export function formatReleaseDate(date: string | null | undefined, locale: Locale): string | null {
  if (!date) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return releaseYear(date)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return releaseYear(date)
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: 'long',
    timeZone: 'UTC'
  }).format(d)
}

/** Şarkıların toplam süresi, dakika (yukarı yuvarlanır; süresi bilinmeyenler sayılmaz). */
export function totalMinutes(tracks: readonly Track[]): number {
  const ms = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0)
  return Math.ceil(ms / 60_000)
}

export type AudioBadge = 'dolbyAtmos' | 'hiResLossless' | 'lossless'

/** Apple `audioVariants` → gösterilecek rozetler (Apple Music sırası; kayıpsızın en iyisi). */
export function audioBadges(variants: readonly string[]): AudioBadge[] {
  const has = new Set(variants)
  const badges: AudioBadge[] = []
  if (has.has('dolby-atmos')) badges.push('dolbyAtmos')
  if (has.has('hi-res-lossless')) badges.push('hiResLossless')
  else if (has.has('lossless')) badges.push('lossless')
  return badges
}

/** Albüm şarkıları disklere göre; tek diskte tek grup (başlık gösterilmez). Albüm sırası korunur. */
export function discGroups(
  tracks: readonly Track[]
): { disc: number; tracks: { track: Track; index: number }[] }[] {
  const groups: { disc: number; tracks: { track: Track; index: number }[] }[] = []
  tracks.forEach((track, index) => {
    const disc = track.discNumber ?? 1
    let group = groups.find((g) => g.disc === disc)
    if (!group) {
      group = { disc, tracks: [] }
      groups.push(group)
    }
    group.tracks.push({ track, index })
  })
  return groups
}
