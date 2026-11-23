import { describe, expect, it, vi } from 'vitest'
import { artistImage, prefetchArtistImage, readyArtistImage } from './artistImage'

const template = 'https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}bb.jpg'

function fakeLibrary(over: { links?: () => Promise<unknown> } = {}) {
  return {
    getSongLinks: vi.fn(over.links ?? (async () => ({ artistId: '42' }))),
    getArtist: vi.fn(async () => ({ artist: { artworkUrl: template } })),
    lookupInfoMedia: vi.fn(async () => ({ artists: [], songs: [] }))
  }
}
type Lib = Parameters<typeof artistImage>[0]

describe('sanatçı fotoğrafı (büyük oynatıcı, 2026-10-18)', () => {
  it('aynı şarkı için tek istek; çözülünce hazır sayılır', async () => {
    const lib = fakeLibrary()
    const t = { catalogId: 'c1', artist: 'A' }
    expect(readyArtistImage(t)).toBeUndefined()
    prefetchArtistImage(lib as unknown as Lib, t)
    const url = await artistImage(lib as unknown as Lib, t)
    expect(url).toContain(encodeURIComponent('1600x1600'))
    expect(lib.getSongLinks).toHaveBeenCalledTimes(1)
    expect(readyArtistImage(t)).toBe(url)
    await artistImage(lib as unknown as Lib, t)
    expect(lib.getSongLinks).toHaveBeenCalledTimes(1)
  })

  it('hata hazır sayılmaz, sonra yeniden denenir; katalog yoksa adla aranır', async () => {
    const lib = fakeLibrary({ links: () => Promise.reject(new Error('ağ')) })
    const t = { catalogId: 'c2', artist: 'B' }
    expect(await artistImage(lib as unknown as Lib, t)).toBeNull()
    expect(readyArtistImage(t)).toBeUndefined()
    await artistImage(lib as unknown as Lib, t)
    expect(lib.getSongLinks).toHaveBeenCalledTimes(2)

    const byName = fakeLibrary()
    expect(await artistImage(byName as unknown as Lib, { artist: 'C' })).toBeNull()
    expect(byName.lookupInfoMedia).toHaveBeenCalledWith(['C'], [])
    prefetchArtistImage(byName as unknown as Lib, { artist: '  ' })
    expect(byName.lookupInfoMedia).toHaveBeenCalledTimes(1)
  })
})
