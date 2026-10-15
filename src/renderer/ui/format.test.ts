import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/ipc-contract'
import { audioBadges, discGroups, formatReleaseDate, releaseYear, totalMinutes } from './format'

const track = (id: string, durationMs: number | null, discNumber?: number): Track => ({
  id,
  name: id,
  artistName: 'A',
  albumName: 'B',
  durationMs,
  playParams: null,
  artworkUrl: null,
  ...(discNumber !== undefined ? { discNumber } : {})
})

describe('sayfa bilgi biçimleri (B5)', () => {
  it('yayın yılı ve tarihi; geçersiz veya eksik tarih', () => {
    expect(releaseYear('2013-05-17')).toBe('2013')
    expect(releaseYear('1975')).toBe('1975')
    expect(releaseYear('x')).toBeNull()
    expect(releaseYear(undefined)).toBeNull()
    expect(formatReleaseDate('2013-05-17', 'tr')).toBe('17 Mayıs 2013')
    expect(formatReleaseDate('2013-05-17', 'en')).toBe('May 17, 2013')
    expect(formatReleaseDate('2013-05', 'tr')).toBe('2013')
    expect(formatReleaseDate(null, 'tr')).toBeNull()
  })

  it('toplam süre dakika olarak yukarı yuvarlanır; süresi bilinmeyen atlanır', () => {
    expect(totalMinutes([track('1', 61_000), track('2', 60_000), track('3', null)])).toBe(3)
    expect(totalMinutes([])).toBe(0)
  })

  it('ses rozetleri: Atmos + kayıpsızın en iyisi; stereo rozet değil', () => {
    expect(audioBadges(['lossless', 'lossy-stereo'])).toEqual(['lossless'])
    expect(audioBadges(['dolby-atmos', 'lossless', 'hi-res-lossless'])).toEqual([
      'dolbyAtmos',
      'hiResLossless'
    ])
    expect(audioBadges(['lossy-stereo'])).toEqual([])
  })

  it('disk grupları albüm sırasını ve genel sırayı korur', () => {
    const groups = discGroups([track('a', 1, 1), track('b', 1, 1), track('c', 1, 2), track('d', 1)])
    expect(groups.map((g) => [g.disc, g.tracks.map((t) => `${t.track.id}${t.index}`)])).toEqual([
      [1, ['a0', 'b1', 'd3']],
      [2, ['c2']]
    ])
  })
})
