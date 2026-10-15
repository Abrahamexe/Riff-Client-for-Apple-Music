import { describe, expect, it, vi } from 'vitest'
import { openSongArtist, primaryArtist, type ArtistLookup } from './artistLink'

const links = (artistId: string | null) => ({
  albumId: '1',
  albumName: 'Albüm',
  albumArtworkUrl: null,
  artistId,
  artistName: 'Johnny Cash'
})

function lookup(over: Partial<ArtistLookup> = {}) {
  return {
    getSongLinks: vi.fn(async () => links('42')),
    searchArtists: vi.fn(async () => [] as { id: string; name: string }[]),
    ...over
  }
}

describe('oynatıcıdaki sanatçı adı', () => {
  it('şarkının sanatçısı varsa ona gider (arama yapılmaz)', async () => {
    const go = vi.fn()
    const l = lookup()
    expect(await openSongArtist({ catalogId: '144', artist: 'Johnny Cash' }, l, go)).toBe(true)
    expect(l.getSongLinks).toHaveBeenCalledWith('144')
    expect(l.searchArtists).not.toHaveBeenCalled()
    expect(go).toHaveBeenCalledWith({ name: 'artist', id: '42', title: 'Johnny Cash' })
  })

  it('katalogda yoksa ana sanatçı adıyla aranır; yalnızca birebir eşleşme açılır', async () => {
    const go = vi.fn()
    const l = lookup({
      getSongLinks: vi.fn(() => Promise.reject(new Error('CONTENT_NOT_FOUND'))),
      searchArtists: vi.fn(async () => [
        { id: '9', name: 'Metro Boomin Tribute' },
        { id: '7', name: 'metro boomin' }
      ])
    })
    const track = { catalogId: '1', artist: 'Metro Boomin, Future & Lil Uzi Vert' }
    expect(await openSongArtist(track, l, go)).toBe(true)
    expect(l.searchArtists).toHaveBeenCalledWith('Metro Boomin')
    expect(go).toHaveBeenCalledWith({ name: 'artist', id: '7', title: 'metro boomin' })
  })

  it('katalog id’si yoksa doğrudan arama; eşleşme yoksa false ve sayfa değişmez', async () => {
    const go = vi.fn()
    const l = lookup({ searchArtists: vi.fn(async () => [{ id: '1', name: 'Başka' }]) })
    expect(await openSongArtist({ artist: 'Yerel Sanatçı' }, l, go)).toBe(false)
    expect(l.getSongLinks).not.toHaveBeenCalled()
    const failing = lookup({ searchArtists: () => Promise.reject(new Error('ağ')) })
    expect(await openSongArtist({ artist: 'X' }, failing, go)).toBe(false)
    expect(await openSongArtist({ artist: '  ' }, l, go)).toBe(false)
    expect(go).not.toHaveBeenCalled()
  })

  it('ana sanatçı: ilk ad', () => {
    expect(primaryArtist('Drake & 21 Savage')).toBe('Drake')
    expect(primaryArtist('A feat. B')).toBe('A')
    expect(primaryArtist('Lil Nas X')).toBe('Lil Nas X')
    expect(primaryArtist('Travis Scott x Kanye')).toBe('Travis Scott')
  })
})
