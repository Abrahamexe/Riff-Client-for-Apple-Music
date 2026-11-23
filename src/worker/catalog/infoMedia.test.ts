import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/ipc-contract'
import { baseTitle, matchArtist, matchSong, nameKey, primaryArtist } from './infoMedia'

const artist = (id: string, name: string) => ({ id, name, artworkUrl: null })
const song = (id: string, name: string, artistName: string): Track => ({
  id,
  name,
  artistName,
  albumName: '',
  durationMs: null,
  playParams: null,
  artworkUrl: null
})

describe('bilgi paneli görsel eşleştirmesi', () => {
  it('ad anahtarı: harf/rakam, aksansız, küçük harf', () => {
    expect(nameKey('Beyoncé')).toBe(nameKey('BEYONCE'))
    expect(nameKey("Pi'erre Bourne")).toBe(nameKey('Pierre Bourne'))
    expect(nameKey('Simon & Garfunkel')).toBe(nameKey('Simon and Garfunkel'))
  })

  it('sanatçı yalnızca birebir adla eşleşir', () => {
    const list = [artist('1', 'Daft Punk Tribute'), artist('2', 'Daft Punk')]
    expect(matchArtist('daft punk', list)?.id).toBe('2')
    expect(matchArtist('Daft', list)).toBeNull()
    expect(matchArtist('  ', list)).toBeNull()
  })

  it('şarkı: ekleri atılmış başlık birebir + ana sanatçı', () => {
    const list = [
      song('9', 'Harder, Better, Faster, Stronger (Live)', 'Someone Else'),
      song('7', 'Harder, Better, Faster, Stronger', 'Daft Punk')
    ]
    expect(matchSong('Harder, Better, Faster, Stronger', 'Daft Punk', list)?.id).toBe('7')
    expect(matchSong('Harder, Better, Faster, Stronger', 'Kanye West', list)).toBeNull()
    expect(baseTitle('Mood Swings (feat. Lil Tjay) - Remastered 2011')).toBe('Mood Swings')
    expect(primaryArtist('Metro Boomin, Future & Lil Uzi Vert')).toBe('Metro Boomin')
    expect(primaryArtist('Lil Nas X')).toBe('Lil Nas X')
  })
})
