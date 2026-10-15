import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AlbumDetailSchema,
  ArtistDetailSchema,
  CardGroupSchema,
  CardSchema,
  PlaylistDetailSchema
} from '@shared/ipc-contract'
import { CatalogService } from '../catalog/catalogService'
import { fakeFetch, paged, songResource } from '../testing'
import { AppleMusicApi } from './appleApi'

// Arayüz veri kapsamı: yanıt yapıları gerçek Apple yanıtlarının gözlenen biçiminden (2026-10-12,
// yalnızca anahtar adları; MANUAL_TESTS "Arayüz veri kapsamı").

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const art = { url: 'https://is1-ssl.mzstatic.com/a/{w}x{h}bb.jpg', width: 100, height: 100 }
const album = (id: string, extra: object = {}) => ({
  id,
  type: 'albums',
  attributes: { name: `Albüm ${id}`, artistName: 'Queen', trackCount: 12, artwork: art, ...extra }
})
const playlistRes = (id: string) => ({
  id,
  type: 'playlists',
  attributes: { name: `Liste ${id}`, curatorName: 'Apple Music', artwork: art }
})
const catalogSong = (id: string, n: number) => ({
  ...songResource(id),
  type: 'songs',
  attributes: { ...songResource(id).attributes, trackNumber: n, discNumber: 1 }
})

function setup(route: (url: URL) => unknown) {
  const { fetch, requests } = fakeFetch((url) =>
    url.pathname === '/v1/me/storefront' ? { data: [{ id: 'tr' }] } : route(url)
  )
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => 'dev',
    getUserToken: () => 'user',
    retry: { retries: 0, sleep: async () => {} }
  })
  return { api, requests }
}

describe('katalog sayfaları (arayüz veri kapsamı)', () => {
  it('albüm: şarkılar (numaralı), explicit, türler ("Müzik" hariç), telif, editoryal not', async () => {
    const { api } = setup((url) =>
      url.pathname === '/v1/catalog/tr/albums/42'
        ? {
            data: [
              {
                ...album('42', {
                  contentRating: 'explicit',
                  releaseDate: '1975-11-21',
                  genreNames: ['Rock', 'Müzik'],
                  copyright: '℗ 1975',
                  recordLabel: 'EMI',
                  editorialNotes: {
                    standard: '<i>Uzun</i> not &amp; daha<br />fazlası',
                    short: 'Kısa'
                  },
                  audioVariants: ['lossless', 'dolby-atmos']
                }),
                relationships: {
                  tracks: { data: [catalogSong('1', 1), catalogSong('2', 2)] },
                  artists: { data: [{ id: '3', type: 'artists' }] }
                },
                views: {
                  'other-versions': { data: [], attributes: { title: 'Diğer Versiyonlar' } },
                  'related-albums': {
                    data: [album('50')],
                    attributes: { title: 'İlgili Albümler' }
                  },
                  'appears-on': {
                    data: [{ id: 'pl.9', type: 'playlists', attributes: { name: 'Rock' } }],
                    attributes: { title: 'Şurada Yer Alıyor:' }
                  }
                }
              }
            ]
          }
        : { data: [] }
    )
    const detail = await api.getAlbum('42')
    expect(AlbumDetailSchema.safeParse(detail).success).toBe(true)
    expect(detail.album).toMatchObject({ id: '42', explicit: true, releaseDate: '1975-11-21' })
    expect(detail.tracks.map((t) => t.trackNumber)).toEqual([1, 2])
    expect(detail).toMatchObject({
      genres: ['Rock'],
      copyright: '℗ 1975',
      recordLabel: 'EMI',
      // B5: HTML etiketleri ayıklanır, satır sonu korunur, varlıklar çözülür.
      editorialNote: 'Uzun not & daha\nfazlası',
      artistId: '3',
      audioVariants: ['lossless', 'dolby-atmos']
    })
    // Boş görünüm atlanır; sıra: Diğer Versiyonlar, İlgili Albümler, Şurada Yer Alıyor.
    expect(detail.sections.map((g) => [g.id, g.title, g.cards.length])).toEqual([
      ['related-albums', 'İlgili Albümler', 1],
      ['appears-on', 'Şurada Yer Alıyor:', 1]
    ])
  })

  it('B5: albüm isteği görünümleri, ses türlerini ve arayüz dilini ister', async () => {
    const { fetch, requests } = fakeFetch((url) =>
      url.pathname === '/v1/me/storefront'
        ? { data: [{ id: 'tr', attributes: { supportedLanguageTags: ['tr-TR', 'en-GB'] } }] }
        : { data: [album('42')] }
    )
    const api = new AppleMusicApi({
      fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user',
      retry: { retries: 0, sleep: async () => {} }
    })
    await api.getAlbum('42', 'tr')
    const q = requests.find((r) => r.url.pathname === '/v1/catalog/tr/albums/42')!.url.searchParams
    expect(q.get('views')).toBe('other-versions,related-albums,appears-on')
    expect(q.get('extend')).toBe('audioVariants')
    expect(q.get('l')).toBe('tr-TR')
  })

  it('B7: katalog araması arayüz dilinde ve istasyonlarla; kütüphane aramasında dil / istasyon yok', async () => {
    const { fetch, requests } = fakeFetch((url) =>
      url.pathname === '/v1/me/storefront'
        ? { data: [{ id: 'tr', attributes: { supportedLanguageTags: ['tr-TR', 'en-GB'] } }] }
        : {
            results: {
              stations: {
                data: [{ id: 'ra.1', type: 'stations', attributes: { name: 'Pop İstasyonu' } }]
              }
            }
          }
    )
    const api = new AppleMusicApi({
      fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user',
      retry: { retries: 0, sleep: async () => {} }
    })
    const catalog = await api.searchGroups('catalog', 'pop', 25, undefined, 'tr')
    expect(catalog.stations.map((s) => s.name)).toEqual(['Pop İstasyonu'])
    const q = requests.find((r) => r.url.pathname === '/v1/catalog/tr/search')!.url.searchParams
    expect(q.get('l')).toBe('tr-TR')
    expect(q.get('types')).toBe('songs,albums,artists,playlists,stations')
    const library = await api.searchGroups('library', 'pop', 25, undefined, 'tr')
    expect(library.stations).toEqual([])
    const lq = requests.find((r) => r.url.pathname === '/v1/me/library/search')!.url.searchParams
    expect(lq.get('l')).toBeNull()
  })

  it('100’den fazla şarkı: ilişki `next` verirse tamamı sayfalarla çekilir; kütüphane albümü include=tracks', async () => {
    const many = Array.from({ length: 150 }, (_, i) => catalogSong(String(i + 1), i + 1))
    const { api, requests } = setup((url) => {
      if (url.pathname === '/v1/me/library/albums/l.9') {
        return {
          data: [
            {
              ...album('l.9'),
              type: 'library-albums',
              relationships: { tracks: { data: many.slice(0, 100), next: '/x' } }
            }
          ]
        }
      }
      if (url.pathname === '/v1/me/library/albums/l.9/tracks') return paged(url, many)
      return { data: [] }
    })
    const detail = await api.getAlbum('l.9')
    expect(detail.tracks).toHaveLength(150)
    expect(requests[0]!.url.searchParams.get('include')).toBe('tracks')
  })

  it('bulunamayan içerik CONTENT_NOT_FOUND (LIB_003)', async () => {
    const { api } = setup(() => new Response('', { status: 404 }))
    await expect(api.getAlbum('1')).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' })
  })

  it('sanatçı: tek istekte görünümler; kütüphane sanatçısı yalnızca albümler', async () => {
    const view = (data: unknown[]) => ({ data, attributes: { title: 'x' } })
    const { api, requests } = setup((url) => {
      if (url.pathname === '/v1/catalog/tr/artists/7') {
        return {
          data: [
            {
              id: '7',
              type: 'artists',
              attributes: { name: 'Queen', artwork: art, genreNames: ['Rock'] },
              views: {
                'top-songs': view([catalogSong('1', 1)]),
                'latest-release': view([album('9')]),
                'full-albums': view([album('9'), album('8')]),
                singles: view([album('5')]),
                'similar-artists': view([
                  { id: '8', type: 'artists', attributes: { name: 'Bowie' } }
                ]),
                'live-albums': view([album('6')]),
                'featured-playlists': view([
                  { id: 'pl.2', type: 'playlists', attributes: { name: 'Queen: Essentials' } }
                ])
              }
            }
          ]
        }
      }
      if (url.pathname === '/v1/me/library/artists/r.1')
        return { data: [{ id: 'r.1', type: 'library-artists', attributes: { name: 'Queen' } }] }
      if (url.pathname === '/v1/me/library/artists/r.1/albums') return paged(url, [album('l.1')])
      return { data: [] }
    })
    const a = await api.getArtist('7')
    expect(ArtistDetailSchema.safeParse(a).success).toBe(true)
    expect(a).toMatchObject({
      artist: { name: 'Queen' },
      latestRelease: { id: '9' },
      similarArtists: [{ name: 'Bowie' }]
    })
    expect(a.albums).toHaveLength(2)
    expect(
      requests.find((r) => r.url.pathname.endsWith('/artists/7'))!.url.searchParams.get('views')
    ).toBe(
      'top-songs,latest-release,full-albums,singles,live-albums,compilation-albums,appears-on-albums,featured-playlists,similar-artists'
    )
    // B5: raflar Apple Music sırasıyla; görünüm başlıkları Apple'dan.
    expect(a.sections.map((g) => g.id)).toEqual([
      'full-albums',
      'singles',
      'live-albums',
      'featured-playlists',
      'similar-artists'
    ])
    expect(a.sections.at(-1)!.cards[0]).toMatchObject({ kind: 'artist', name: 'Bowie' })
    expect(a).toMatchObject({ topSongsTitle: 'x', latestReleaseTitle: 'x', genres: ['Rock'] })
    const lib = await api.getArtist('r.1')
    expect(lib).toMatchObject({ artist: { name: 'Queen' }, topSongs: [], albums: [{ id: 'l.1' }] })
    expect(lib.sections).toMatchObject([{ id: 'library-albums', cards: [{ id: 'l.1' }] }])
    expect(ArtistDetailSchema.safeParse(lib).success).toBe(true)
  })

  it('katalog playlist’i: küratör + şarkılar', async () => {
    const { api } = setup(() => ({
      data: [
        {
          id: 'pl.1',
          type: 'playlists',
          attributes: {
            name: 'Bugünün Hitleri',
            curatorName: 'Apple Music',
            artwork: art,
            description: { standard: 'En yeni <b>hitler</b>.' }
          },
          relationships: { tracks: { data: [catalogSong('1', 1)] } },
          views: {
            'featured-artists': {
              data: [{ id: '8', type: 'artists', attributes: { name: 'Bowie' } }],
              attributes: { title: 'Öne Çıkan Sanatçılar' }
            }
          }
        }
      ]
    }))
    const p = await api.getCatalogPlaylist('pl.1')
    expect(PlaylistDetailSchema.safeParse(p).success).toBe(true)
    expect(p).toMatchObject({
      curatorName: 'Apple Music',
      playlist: { name: 'Bugünün Hitleri', description: 'En yeni hitler.' },
      sections: [{ id: 'featured-artists', title: 'Öne Çıkan Sanatçılar' }]
    })
  })

  it('öneriler: başlıklı gruplar; desteklenmeyen tür ve boş grup atlanır', async () => {
    const { api } = setup(() => ({
      data: [
        {
          id: 'g1',
          type: 'personal-recommendation',
          attributes: { title: { stringForDisplay: 'Sizin İçin' }, kind: 'music-recommendations' },
          relationships: {
            contents: {
              data: [
                album('1'),
                {
                  id: 'pl.2',
                  type: 'playlists',
                  attributes: { name: 'Mix', curatorName: 'Apple Music' }
                },
                { id: 'ra.3', type: 'stations', attributes: { name: 'Radyo', isLive: false } },
                { id: 'mv', type: 'music-videos', attributes: { name: 'Video' } }
              ]
            }
          }
        },
        {
          id: 'g2',
          type: 'personal-recommendation',
          attributes: { title: { stringForDisplay: 'Boş' } },
          relationships: { contents: { data: [] } }
        }
      ]
    }))
    const groups = await api.getRecommendations()
    expect(groups).toHaveLength(1)
    expect(CardGroupSchema.safeParse(groups[0]).success).toBe(true)
    expect(groups[0]!.cards.map((c) => [c.kind, c.subtitle])).toEqual([
      ['album', 'Queen'],
      ['playlist', 'Apple Music'],
      ['station', '']
    ])
  })

  it('B4 ek: öneri başlıkları arayüz dilinde — storefront’un desteklediği etiket `l` olarak gider', async () => {
    const { fetch, requests } = fakeFetch((url) =>
      url.pathname === '/v1/me/storefront'
        ? {
            data: [
              {
                id: 'tr',
                attributes: { supportedLanguageTags: ['tr-TR', 'en-GB', 'bad tag;x'] }
              }
            ]
          }
        : { data: [] }
    )
    const api = new AppleMusicApi({
      fetch,
      getDeveloperToken: async () => 'dev',
      getUserToken: () => 'user',
      retry: { retries: 0, sleep: async () => {} }
    })
    const recs = () => requests.filter((q) => q.url.pathname === '/v1/me/recommendations')
    await api.getRecommendations('tr')
    await api.getRecommendations('en')
    await api.getRecommendations()
    expect(recs().map((q) => q.url.searchParams.get('l'))).toEqual(['tr-TR', 'en-GB', null])
  })

  it('B4 ek: storefront dil listesi vermezse `l` gönderilmez', async () => {
    const { api, requests } = setup(() => ({ data: [] }))
    await api.getRecommendations('en')
    const rec = requests.find((q) => q.url.pathname === '/v1/me/recommendations')!
    expect(rec.url.searchParams.has('l')).toBe(false)
  })

  it('B4 ek: sık çalınanlar — kütüphane playlist’i, albüm ve istasyon kartları', async () => {
    const { api, requests } = setup((url) =>
      paged(url, [
        { id: 'p.1', type: 'library-playlists', attributes: { name: 'Benim', artwork: art } },
        album('2'),
        { id: 'ra.3', type: 'stations', attributes: { name: 'İstasyon' } },
        { id: 'mv', type: 'music-videos', attributes: { name: 'Video' } }
      ])
    )
    const items = await api.getHeavyRotation(10)
    expect(requests[0]!.url.pathname).toBe('/v1/me/history/heavy-rotation')
    expect(items.map((c) => `${c.kind}:${c.id}`)).toEqual([
      'playlist:p.1',
      'album:2',
      'station:ra.3'
    ])
    for (const c of items) expect(CardSchema.safeParse(c).success).toBe(true)
  })

  it('listeler (Göz At) ve canlı radyo', async () => {
    const { api, requests } = setup((url) => {
      if (url.pathname === '/v1/catalog/tr/charts') {
        return {
          results: {
            songs: [
              { chart: 'most-played', name: 'En Çok Çalınan Şarkılar', data: [catalogSong('1', 1)] }
            ],
            albums: [{ chart: 'most-played', name: 'En Çok Çalınan Albümler', data: [album('2')] }]
          }
        }
      }
      return {
        data: [
          {
            id: 'ra.1',
            type: 'stations',
            attributes: {
              name: 'Apple Music 1',
              isLive: true,
              stationProviderName: 'Apple',
              artwork: art,
              editorialNotes: { short: 'Şimdi Canlı', tagline: '<i>En iyi</i> yeni müzik.' }
            }
          }
        ]
      }
    })
    const charts = await api.getCharts(20)
    expect(charts.map((g) => g.id)).toEqual(['songs:most-played', 'albums:most-played'])
    expect(requests[1]!.url.searchParams.get('types')).toBe('songs,albums,playlists')
    const stations = await api.getLiveStations()
    expect(CardSchema.safeParse(stations[0]).success).toBe(true)
    expect(stations[0]).toMatchObject({
      kind: 'station',
      isLive: true,
      subtitle: 'Apple',
      tagline: 'En iyi yeni müzik.'
    })
    expect(requests.at(-1)!.url.searchParams.get('filter[featured]')).toBe('apple-music-live-radio')
  })

  it('B6 "Yeni": dil, günlük / şehir listeleri, Apple sırası; türe göre `with` yok', async () => {
    const { api, requests } = setup((url) => {
      if (url.pathname === '/v1/me/storefront') return { data: [{ id: 'tr' }] }
      return {
        results: {
          cityCharts: [{ chart: 'city-top', name: 'Şehir Listeleri', data: [playlistRes('pl.c')] }],
          playlists: [
            { chart: 'most-played', name: 'Popüler Listeler', data: [playlistRes('pl.p')] }
          ],
          dailyGlobalTopCharts: [
            { chart: 'daily-global-top', name: 'Günlük Top 100', data: [playlistRes('pl.d')] }
          ],
          songs: [{ chart: 'most-played', name: 'Popüler Parçalar', data: [catalogSong('1', 1)] }],
          albums: [{ chart: 'most-played', name: 'Popüler Albümler', data: [album('2')] }],
          musicVideos: [{ chart: 'most-played', name: 'Videolar', data: [] }]
        }
      }
    })
    const charts = await api.getCharts(24, 'tr')
    expect(charts.map((g) => `${g.id}=${g.title}`)).toEqual([
      'songs:most-played=Popüler Parçalar',
      'albums:most-played=Popüler Albümler',
      'playlists:most-played=Popüler Listeler',
      'dailyGlobalTopCharts:daily-global-top=Günlük Top 100',
      'cityCharts:city-top=Şehir Listeleri'
    ])
    const q = requests.at(-1)!.url.searchParams
    expect(q.get('with')).toBe('dailyGlobalTopCharts,cityCharts')
    expect(q.get('limit')).toBe('24')
    expect(q.get('genre')).toBeNull()
    await api.getCharts(24, 'tr', '14')
    const g = requests.at(-1)!.url.searchParams
    expect(g.get('genre')).toBe('14')
    expect(g.get('with')).toBeNull()
  })

  it('B6 türler: kök "Müzik" (34) ve adsız tür atlanır; istasyon türleri ve tür istasyonları', async () => {
    const { api, requests } = setup((url) => {
      switch (url.pathname) {
        case '/v1/catalog/tr/genres':
          return {
            data: [
              { id: '34', type: 'genres', attributes: { name: 'Müzik' } },
              { id: '14', type: 'genres', attributes: { name: 'Pop' } },
              { id: '99', type: 'genres', attributes: {} }
            ]
          }
        case '/v1/catalog/tr/station-genres':
          return {
            data: [{ id: '1149302661', type: 'station-genres', attributes: { name: 'Pop' } }]
          }
        case '/v1/catalog/tr/station-genres/1149302661/stations':
          return {
            data: [
              {
                id: 'ra.1',
                type: 'stations',
                attributes: {
                  name: "Hit'ler İstasyonu",
                  isLive: false,
                  artwork: art,
                  editorialNotes: { tagline: 'Apple Music İstasyonu' }
                }
              }
            ]
          }
        default:
          return { data: [] }
      }
    })
    expect(await api.getGenres('tr')).toEqual([{ id: '14', name: 'Pop' }])
    expect(await api.getStationGenres('tr')).toEqual([{ id: '1149302661', name: 'Pop' }])
    const stations = await api.getGenreStations('1149302661', 'tr')
    expect(stations[0]).toMatchObject({
      kind: 'station',
      name: "Hit'ler İstasyonu",
      isLive: false,
      tagline: 'Apple Music İstasyonu'
    })
    expect(CardSchema.safeParse(stations[0]).success).toBe(true)
    expect(requests.at(-1)!.url.searchParams.get('limit')).toBe('25')
  })

  it('B6 son dinlenen istasyonlar: sayfa en fazla 10, dil parametresi', async () => {
    const { api, requests } = setup((url) =>
      paged(url, [
        { id: 'ra.1', type: 'stations', attributes: { name: 'Apple Music 1', isLive: true } },
        { id: 'ra.2', type: 'stations', attributes: { name: 'Joji', isLive: false } }
      ])
    )
    const items = await api.getRecentStations(20)
    expect(items.map((c) => `${c.kind}:${c.id}:${c.isLive}`)).toEqual([
      'station:ra.1:true',
      'station:ra.2:false'
    ])
    const r = requests.find((x) => x.url.pathname === '/v1/me/recent/radio-stations')!
    expect(r.url.searchParams.get('limit')).toBe('10')
  })

  it('şarkı menüsü: albüm ve sanatçı ilişkileri tek istekte', async () => {
    const { api, requests } = setup(() => ({
      data: [
        {
          ...catalogSong('9', 1),
          relationships: {
            albums: { data: [album('2')] },
            artists: { data: [{ id: '3', type: 'artists', attributes: { name: 'Queen' } }] }
          }
        }
      ]
    }))
    const links = await api.getSongLinks('9')
    expect(links).toMatchObject({
      albumId: '2',
      albumName: 'Albüm 2',
      artistId: '3',
      artistName: 'Queen'
    })
    const q = requests.find((r) => r.url.pathname === '/v1/catalog/tr/songs/9')!
    expect(q.url.searchParams.get('include')).toBe('albums,artists')
  })

  it('son eklenenler: sayfa boyutu 25 (Apple sınırı)', async () => {
    const { api, requests } = setup((url) => paged(url, [album('1')]))
    await api.getRecentlyAdded(25)
    expect(requests[0]!.url.searchParams.get('limit')).toBe('25')
  })
})

describe('CatalogService önbelleği', () => {
  it('aynı sayfa süre dolana kadar ağa çıkmaz; eşzamanlı istekler paylaşılır; hata saklanmaz; çıkışta silinir', async () => {
    const clock = { t: 0 }
    let fail = true
    const api = {
      getAlbum: vi.fn(async (id: string) => {
        if (fail) {
          fail = false
          throw new Error('ağ yok')
        }
        return { id } as never
      }),
      getArtist: vi.fn(),
      getCatalogPlaylist: vi.fn(),
      getRecommendations: vi.fn(async () => []),
      getHeavyRotation: vi.fn(),
      getCharts: vi.fn(async () => []),
      getGenres: vi.fn(),
      getLiveStations: vi.fn(),
      getRecentStations: vi.fn(),
      getStationGenres: vi.fn(),
      getGenreStations: vi.fn(),
      getRecentlyAdded: vi.fn(),
      getSongLinks: vi.fn(),
      searchGroups: vi.fn()
    }
    const service = new CatalogService(api, () => clock.t)
    await expect(service.getAlbum('1')).rejects.toThrow('ağ yok')
    await Promise.all([service.getAlbum('1'), service.getAlbum('1')])
    expect(api.getAlbum).toHaveBeenCalledTimes(2)
    clock.t += 9 * 60_000
    await service.getAlbum('1')
    expect(api.getAlbum).toHaveBeenCalledTimes(2)
    clock.t += 2 * 60_000
    await service.getAlbum('1')
    expect(api.getAlbum).toHaveBeenCalledTimes(3)
    await service.getRecommendations()
    service.clear()
    await service.getRecommendations()
    expect(api.getRecommendations).toHaveBeenCalledTimes(2)
    // Dil başına ayrı önbellek (başlıklar dile göre değişir).
    await service.getRecommendations('en')
    await service.getRecommendations('en')
    expect(api.getRecommendations).toHaveBeenCalledTimes(3)
    expect(api.getRecommendations).toHaveBeenLastCalledWith('en')
    // B6: listeler tür ve dil başına ayrı.
    await service.getCharts(20, 'tr')
    await service.getCharts(20, 'tr', '14')
    await service.getCharts(20, 'tr', '14')
    expect(api.getCharts).toHaveBeenCalledTimes(2)
    expect(api.getCharts).toHaveBeenLastCalledWith(20, 'tr', '14')
  })
})

describe('CatalogService.lookupInfoMedia (§3.5)', () => {
  it('sıra korunur; güvenli eşleşme yoksa / hata olursa null; aynı ad önbellekten', async () => {
    const groups = (
      artists: { id: string; name: string }[],
      songs: { id: string; name: string; artistName: string }[]
    ) => ({
      top: [],
      albums: [],
      playlists: [],
      stations: [],
      artists: artists.map((a) => ({ ...a, artworkUrl: 'https://x/{w}x{h}.jpg' })),
      songs: songs.map((s) => ({
        ...s,
        albumName: '',
        durationMs: null,
        playParams: null,
        artworkUrl: null
      }))
    })
    const searchGroups = vi.fn(async (_src: string, term: string) => {
      if (term === 'Hata') throw new Error('ağ')
      if (term === 'Daft Punk') return groups([{ id: '5', name: 'Daft Punk' }], [])
      if (term === 'Kanye West') return groups([{ id: '6', name: 'Kanye West Tribute' }], [])
      return groups(
        [],
        [{ id: '77', name: 'Harder, Better, Faster, Stronger', artistName: 'Daft Punk' }]
      )
    })
    const service = new CatalogService({ searchGroups } as never, () => 0)
    const res = await service.lookupInfoMedia(
      ['Daft Punk', 'Kanye West', 'Hata'],
      [{ title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk' }]
    )
    expect(res.artists.map((a) => a?.id ?? null)).toEqual(['5', null, null])
    expect(res.songs.map((s) => s?.id ?? null)).toEqual(['77'])
    await service.lookupInfoMedia(['Daft Punk'], [])
    expect(searchGroups.mock.calls.filter((c) => c[1] === 'Daft Punk')).toHaveLength(1)
  })
})

describe('kütüphane sanatçısı görseli', () => {
  it('kendi görseli yoksa katalog sanatçısının görseli; ikisi de yoksa yok', async () => {
    const { toLibraryArtist } = await import('./schemas')
    const withCatalog = toLibraryArtist({
      id: 'r.1',
      attributes: { name: 'Drake' },
      relationships: {
        catalog: {
          data: [
            {
              id: '271256',
              attributes: { artwork: { url: 'https://is1.mzstatic.com/a/{w}x{h}bb.jpg' } }
            }
          ]
        }
      }
    })
    expect(withCatalog.artworkUrl).toContain('mzstatic.com/a/')
    expect(toLibraryArtist({ id: 'r.2', attributes: { name: 'Yerel' } }).artworkUrl).toBeNull()
  })
})

describe('kütüphane şarkı / albüm eşlemesi (§3.6)', () => {
  it('tür kütüphaneden, besteci ve derleme katalog ilişkisinden; yoksa boş', async () => {
    const { toLibraryAlbum, toLibrarySong } = await import('./schemas')
    const song = toLibrarySong({
      id: 'i.1',
      attributes: { name: 'Stronger', genreNames: ['Müzik', 'Hip-Hop/Rap'] },
      relationships: {
        catalog: { data: [{ id: '144', attributes: { composerName: ' Ye, Mike Dean ' } }] }
      }
    })
    expect(song).toMatchObject({ id: 'i.1', genre: 'Hip-Hop/Rap', composer: 'Ye, Mike Dean' })
    expect(toLibrarySong({ id: 'i.2', attributes: { name: 'Yüklenmiş' } })).toMatchObject({
      genre: null,
      composer: null
    })
    expect(
      toLibraryAlbum({
        id: 'l.1',
        attributes: { name: 'Now 100' },
        relationships: { catalog: { data: [{ id: '9', attributes: { isCompilation: true } }] } }
      })
    ).toMatchObject({ compilation: true, genre: null })
    expect(toLibraryAlbum({ id: 'l.2', attributes: {} }).compilation).toBe(false)
  })
})
