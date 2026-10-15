import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '@shared/errors'
import { fakeFetch, paged, playlistResource, songResource } from '../testing'
import { AppleMusicApi, MAX_PAGES, PAGE_SIZE, parseRetryAfter } from './appleApi'
import { artworkUrl, pathLabel, resetSchemaDriftForTests } from './schemas'

const DEV = 'dev-token-SECRET'
const USER = 'user-token-SECRET'

function setup(route: Parameters<typeof fakeFetch>[0], userToken: string | null = USER) {
  const { fetch, requests } = fakeFetch(route)
  let token = userToken
  const sleep = vi.fn(async () => {})
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => DEV,
    getUserToken: () => token,
    retry: { sleep, random: () => 0 }
  })
  return { api, requests, sleep, setUserToken: (t: string | null) => (token = t) }
}

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response('{"errors":[{"detail":"gizli ayrıntı"}]}', { status: code, headers })

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('istek ve başlıklar', () => {
  it('developer token her istekte; user token yalnızca /v1/me isteklerinde', async () => {
    const { api, requests } = setup((url) =>
      url.pathname.includes('/catalog/') ? { results: {} } : { data: [] }
    )
    await api.getPlaylists()
    await api.searchCatalog('x', 5, 'de')
    expect(requests[0]!.headers).toEqual({
      Authorization: `Bearer ${DEV}`,
      'Music-User-Token': USER
    })
    expect(requests[1]!.headers).toEqual({ Authorization: `Bearer ${DEV}` })
    expect(requests[1]!.url.origin).toBe('https://api.music.apple.com')
  })

  it('giriş yapılmamışsa /v1/me isteği ağa çıkmadan NOT_SIGNED_IN (oturum silmeyi tetiklemez)', async () => {
    const { api, requests } = setup(() => ({ data: [] }), null)
    await expect(api.getPlaylists()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    expect(requests).toHaveLength(0)
  })

  it('aynı anda yapılan aynı GET tek isteğe indirilir', async () => {
    const { api, requests } = setup(() => ({ data: [] }))
    await Promise.all([api.get('/v1/me/x'), api.get('/v1/me/x'), api.get('/v1/me/y')])
    expect(requests).toHaveLength(2)
  })
})

describe('sayfalama', () => {
  it('next bitene kadar offset ilerleterek tüm sayfaları toplar', async () => {
    const all = Array.from({ length: 5 }, (_, i) => playlistResource(`p${i}`))
    const { api, requests } = setup((url) => paged(url, all))
    const items = await api.fetchAll('/v1/me/library/playlists', {}, { pageSize: 2 })
    expect(items.map((i) => i.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(requests.map((r) => r.url.searchParams.get('offset'))).toEqual(['0', '2', '4'])
  })

  it('toplam (meta.total) biliniyorsa kalan sayfalar en fazla 4 eşzamanlı çekilir; sıra korunur (2.2)', async () => {
    const all = Array.from({ length: 1_204 }, (_, i) => songResource(`i.${i}`))
    let inFlight = 0
    let peak = 0
    const { requests } = fakeFetch(() => ({}))
    const api = new AppleMusicApi({
      fetch: async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input)
        requests.push({ url, headers: {} })
        inFlight++
        peak = Math.max(peak, inFlight)
        // Sonraki sayfalar ters sırada bitsin: sıralamanın korunduğu sınansın.
        const offset = Number(url.searchParams.get('offset'))
        await new Promise((r) => setTimeout(r, 30 - offset / 100))
        inFlight--
        return new Response(JSON.stringify({ ...paged(url, all), meta: { total: all.length } }), {
          status: 200
        })
      },
      getDeveloperToken: async () => DEV,
      getUserToken: () => USER,
      retry: { sleep: async () => {}, random: () => 0 }
    })
    const items = await api.fetchAll('/v1/me/library/playlists/p.1/tracks')
    expect(items.map((i) => i.id)).toEqual(all.map((s) => s.id))
    expect(requests).toHaveLength(13)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  describe('sayfa sınırı (A4)', () => {
    const limited = (route: Parameters<typeof fakeFetch>[0]) => {
      const { fetch, requests } = fakeFetch(route)
      const api = new AppleMusicApi({
        fetch,
        getDeveloperToken: async () => DEV,
        getUserToken: () => USER,
        maxPages: 3
      })
      return { api, requests }
    }
    const all = Array.from({ length: 10 }, (_, i) => songResource(`s${i}`))

    it('varsayılan sınır 200.000 öğe (eski 20.000 sınırı yok)', () => {
      expect(MAX_PAGES * PAGE_SIZE).toBe(200_000)
    })

    it('toplam bilinirken sınır aşılırsa LIBRARY_TRUNCATED uyarısı; sayı yazılır, sorgu yazılmaz', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { api, requests } = limited((url) => ({ ...paged(url, all), meta: { total: 10 } }))
      expect(await api.fetchAll('/v1/me/library/songs', {}, { pageSize: 2 })).toHaveLength(6)
      expect(requests).toHaveLength(3)
      const logged = JSON.stringify(warn.mock.calls)
      expect(logged).toContain('LIB_004')
      expect(logged).toContain('10 öğeden 6')
    })

    it('toplam yokken sınır aşılırsa da uyarı; sınıra tam sığan liste uyarı vermez', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { api } = limited((url) => paged(url, all))
      expect(await api.fetchAll('/v1/me/recent/played', {}, { pageSize: 2 })).toHaveLength(6)
      expect(JSON.stringify(warn.mock.calls)).toContain('LIB_004')

      warn.mockClear()
      const exact = limited((url) => paged(url, all.slice(0, 6)))
      expect(await exact.api.fetchAll('/v1/me/recent/played', {}, { pageSize: 2 })).toHaveLength(6)
      const exactTotal = limited((url) => ({ ...paged(url, all.slice(0, 6)), meta: { total: 6 } }))
      expect(
        await exactTotal.api.fetchAll('/v1/me/library/songs', {}, { pageSize: 2 })
      ).toHaveLength(6)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('LIB_004')
    })
  })

  it('maxItems ile erken durur ve fazlasını keser', async () => {
    const all = Array.from({ length: 10 }, (_, i) => songResource(`s${i}`))
    const { api, requests } = setup((url) => paged(url, all))
    expect(await api.fetchAll('/x', {}, { pageSize: 2, maxItems: 3 })).toHaveLength(3)
    expect(requests).toHaveLength(2)
  })

  it('boş kütüphane tek istekle boş liste; boş playlist (404) boş liste', async () => {
    const { api, requests } = setup((url) =>
      url.pathname.endsWith('/tracks') ? status(404) : { data: [] }
    )
    expect(await api.getPlaylists()).toEqual([])
    expect(await api.getPlaylistTracks('p.1')).toEqual([])
    expect(requests).toHaveLength(2)
  })

  it('playlist id URL’ye kodlanarak eklenir', async () => {
    const { api, requests } = setup(() => ({ data: [] }))
    await api.getPlaylistTracks('p.a/b?c')
    expect(requests[0]!.url.pathname).toBe('/v1/me/library/playlists/p.a%2Fb%3Fc/tracks')
  })
})

describe('yanıt doğrulama (Güvenlik kuralı 6)', () => {
  it('kaynakları Track/Playlist’e çevirir', async () => {
    const { api } = setup((url) =>
      url.pathname.endsWith('/tracks') ? { data: [songResource('1')] } : { data: [] }
    )
    expect(await api.getPlaylistTracks('p.1')).toEqual([
      {
        id: '1',
        name: 'Şarkı 1',
        artistName: 'Sanatçı',
        albumName: 'Albüm',
        durationMs: 180_000,
        playParams: { id: '1', kind: 'song', catalogId: 'c1' },
        artworkUrl: 'https://is1-ssl.mzstatic.com/x/300x300.jpg'
      }
    ])
  })

  it('beklenmeyen/hatalı alanlar çökme sebebi olmaz; id’siz öğe atlanır', async () => {
    const { api } = setup(() => ({
      data: [
        { attributes: { name: 'id yok' } },
        'string öğe',
        null,
        {
          id: 'x',
          extra: { derin: true },
          attributes: {
            name: 42,
            artistName: ['dizi'],
            durationInMillis: 'uzun',
            playParams: { kind: 'song' },
            artwork: { url: 'javascript:alert(1)//{w}x{h}' }
          }
        }
      ],
      next: 12
    }))
    const tracks = await api.getPlaylistTracks('p.1')
    expect(tracks).toEqual([
      {
        id: 'x',
        name: '',
        artistName: '',
        albumName: '',
        durationMs: null,
        playParams: null,
        artworkUrl: null
      }
    ])
  })

  it('gövde nesne değilse ZodError değil katalog kodu (API_RESPONSE_INVALID, NET_005)', async () => {
    const { api } = setup(() => 'düz metin')
    await expect(api.getPlaylists()).rejects.toMatchObject({
      code: 'API_RESPONSE_INVALID',
      id: 'NET_005'
    })
    await expect(api.searchLibrary('x')).rejects.toBeInstanceOf(CoreError)
  })

  it('atlanan öğeler katalog koduyla loglanır', async () => {
    const warn = vi.mocked(console.warn)
    const { api } = setup((url) => paged(url, [{ id: '' }, playlistResource('p1')]))
    await api.getPlaylists()
    expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(
      /NET_005 API_RESPONSE_INVALID: .*1 geçersiz öğe/
    )
  })

  it('şema sapması (V5): yol ve sorun kodu bir kez loglanır, değerler ve kimlikler loglanmaz', async () => {
    resetSchemaDriftForTests()
    const warn = vi.mocked(console.warn)
    const odd = {
      id: 'i.GIZLIKIMLIK',
      attributes: { name: 'Gizli Şarkı Adı', durationInMillis: 'uzun', artwork: { url: 7 } }
    }
    const { api } = setup((url) => paged(url, [odd, songResource('s1')]))
    await api.getPlaylistTracks('p.KISISELID')
    await api.getPlaylistTracks('p.KISISELID') // ikinci kez: tekrar loglanmaz
    const logged = warn.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.includes('şemaya uymayan'))
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('/v1/me/library/playlists/:id/tracks')
    expect(logged[0]).toContain('attributes.durationInMillis:invalid_type')
    expect(logged[0]).toContain('attributes.artwork.url:invalid_type')
    for (const secret of ['Gizli Şarkı Adı', 'uzun', 'KISISELID', 'GIZLIKIMLIK']) {
      expect(warn.mock.calls.flat().join(' ')).not.toContain(secret)
    }
  })

  it('arama sonuçlarında da şema sapması loglanır', async () => {
    resetSchemaDriftForTests()
    const warn = vi.mocked(console.warn)
    const { api } = setup(() => ({
      results: { 'library-songs': { data: [{ id: 'i.1', attributes: { canEdit: 'evet' } }] } }
    }))
    await api.searchLibrary('x')
    expect(warn.mock.calls.flat().join(' ')).toContain(
      'search:library-songs: şemaya uymayan alanlar (değerler loglanmaz): attributes.canEdit:invalid_type'
    )
  })

  it.each([
    ['/v1/me/library/playlists/p.AbC123/tracks', '/v1/me/library/playlists/:id/tracks'],
    ['/v1/catalog/tr/songs/1440857781', '/v1/catalog/tr/songs/:id'],
    ['/v1/me/recent/played/tracks', '/v1/me/recent/played/tracks']
  ])('pathLabel(%s) → %s', (path, label) => expect(pathLabel(path)).toBe(label))

  it('data dizi değilse boş sayılır', async () => {
    const { api } = setup(() => ({ data: 'bozuk' }))
    expect(await api.getPlaylists()).toEqual([])
  })

  it.each([
    ['https://a.mzstatic.com/{w}x{h}.jpg', 'https://a.mzstatic.com/300x300.jpg'],
    ['http://a.mzstatic.com/{w}x{h}.jpg', null],
    ['data:image/png;base64,AAAA', null],
    ['geçersiz', null],
    [undefined, null]
  ])('artworkUrl(%s) → %s', (input, expected) => expect(artworkUrl(input)).toBe(expected))
})

describe('hata yönetimi (1.9)', () => {
  it('403 → UNAUTHORIZED, tekrar denenmez, yanıt gövdesi mesaja girmez', async () => {
    const { api, requests } = setup(() => status(403))
    const err = await api.getPlaylists().catch((e: CoreError) => e)
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 403 })
    expect((err as CoreError).message).not.toContain('gizli')
    expect(requests).toHaveLength(1)
  })

  describe('401 → developer token zorla yenilenir (A3.1)', () => {
    function withTokens(route: Parameters<typeof fakeFetch>[0]) {
      const { fetch, requests } = fakeFetch(route)
      const tokens = ['dev-old', 'dev-new']
      const getDeveloperToken = vi.fn(async (refresh?: boolean) =>
        refresh ? tokens[1]! : tokens[0]!
      )
      const api = new AppleMusicApi({
        fetch,
        getDeveloperToken,
        getUserToken: () => USER,
        retry: { sleep: async () => {}, random: () => 0 }
      })
      return { api, requests, getDeveloperToken }
    }

    it('yenilenen token kabul edilirse istek başarılı', async () => {
      const { api, requests, getDeveloperToken } = withTokens(() =>
        requests.at(-1)!.headers.Authorization === 'Bearer dev-new' ? { data: [] } : status(401)
      )
      expect(await api.getPlaylists()).toEqual([])
      expect(requests.map((r) => r.headers.Authorization)).toEqual([
        'Bearer dev-old',
        'Bearer dev-new'
      ])
      expect(getDeveloperToken.mock.calls).toEqual([[false], [true]])
    })

    it('yenilenen token da 401 → UNAUTHORIZED; yalnızca bir kez yenilenir', async () => {
      const { api, requests, getDeveloperToken } = withTokens(() => status(401))
      const err = await api.getPlaylists().catch((e: CoreError) => e)
      expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
      expect((err as CoreError).message).not.toContain('gizli')
      expect(requests).toHaveLength(2)
      expect(getDeveloperToken).toHaveBeenCalledTimes(2)
    })

    it('yazma isteği de bir kez yenilenip tekrarlanır', async () => {
      const { api, requests } = withTokens(() =>
        requests.at(-1)!.headers.Authorization === 'Bearer dev-new'
          ? new Response(null, { status: 204 })
          : status(401)
      )
      await api.setRating('songs', 's1', 1)
      expect(requests).toHaveLength(2)
    })
  })

  describe('yönlendirmeler (P8, F1)', () => {
    const moved = (location: string) => () =>
      new Response(null, { status: 302, headers: { location } })

    it('aynı origin’e yönlendirme izlenir; kullanıcı token’ı yalnızca Apple API’ye gider', async () => {
      const { api, requests } = setup((url) =>
        url.pathname === '/v1/me/library/playlists' && !url.searchParams.has('moved')
          ? moved('/v1/me/library/playlists?moved=1')()
          : { data: [] }
      )
      expect(await api.getPlaylists()).toEqual([])
      expect(requests).toHaveLength(2)
      expect(requests[1]!.url.origin).toBe('https://api.music.apple.com')
    })

    it('başka origin’e yönlendirme izlenmez (token sızmaz): API_REQUEST_FAILED, hedefe istek yok', async () => {
      const { api, requests } = setup(moved('https://evil.example/steal'))
      await expect(api.getPlaylists()).rejects.toMatchObject({
        code: 'API_REQUEST_FAILED',
        status: 302
      })
      expect(requests.map((r) => r.url.host)).toEqual(['api.music.apple.com'])
    })

    it('yazma isteğinde yönlendirme izlenmez; döngü 3 adımda kesilir', async () => {
      const write = setup(moved('/v1/me/ratings/songs/1?x=1'))
      await expect(write.api.setRating('songs', '1', 1)).rejects.toMatchObject({
        code: 'API_REQUEST_FAILED'
      })
      expect(write.requests).toHaveLength(1)
      const loop = setup(moved('/v1/me/library/playlists'))
      await expect(loop.api.getPlaylists()).rejects.toMatchObject({ code: 'API_REQUEST_FAILED' })
      expect(loop.requests).toHaveLength(4)
    })
  })

  it('429 Retry-After’a uyarak tekrar dener', async () => {
    let n = 0
    const { api, sleep } = setup(() =>
      n++ === 0 ? status(429, { 'retry-after': '2' }) : { data: [] }
    )
    expect(await api.getPlaylists()).toEqual([])
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('5xx ve ağ hatası geri çekilmeyle tekrar denenir, sonunda fırlatılır', async () => {
    const { api, requests } = setup(() => status(503))
    await expect(api.getPlaylists()).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    expect(requests).toHaveLength(4) // 1 + 3 tekrar

    const offline = setup(() => new TypeError('fetch failed'))
    await expect(offline.api.getPlaylists()).rejects.toMatchObject({ code: 'OFFLINE' })
  })

  it('bozuk JSON → API_REQUEST_FAILED', async () => {
    const { api } = setup(() => new Response('<html>', { status: 200 }))
    await expect(api.getPlaylists()).rejects.toMatchObject({ code: 'API_REQUEST_FAILED' })
  })

  it('developer token alınamazsa ağa çıkılmaz', async () => {
    const { fetch, requests } = fakeFetch(() => ({ data: [] }))
    const api = new AppleMusicApi({
      fetch,
      getDeveloperToken: () =>
        Promise.reject(new CoreError('DEVELOPER_TOKEN_UNAVAILABLE', '.env eksik')),
      getUserToken: () => USER
    })
    await expect(api.getPlaylists()).rejects.toMatchObject({ code: 'DEVELOPER_TOKEN_UNAVAILABLE' })
    expect(requests).toHaveLength(0)
  })

  it('parseRetryAfter: saniye ve HTTP tarihi', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000)
    expect(parseRetryAfter('abc')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })
})

describe('arama ve storefront', () => {
  it('storefront hesaptan alınır (sabit yazılmaz) ve user token başına cache’lenir', async () => {
    const { api, requests, setUserToken } = setup((url) => {
      if (url.pathname === '/v1/me/storefront') return { data: [{ id: 'de' }] }
      return { results: { songs: { data: [songResource('1')] }, playlists: { data: [] } } }
    })
    const r = await api.searchCatalog('queen', 5)
    await api.searchCatalog('queen 2', 5)
    expect(r.songs.map((s) => s.id)).toEqual(['1'])
    const paths = requests.map((q) => q.url.pathname)
    expect(paths).toEqual(['/v1/me/storefront', '/v1/catalog/de/search', '/v1/catalog/de/search'])
    expect(requests[1]!.url.searchParams.get('types')).toBe('songs,playlists')

    setUserToken('baska-hesap')
    await api.searchCatalog('x')
    expect(requests.filter((q) => q.url.pathname === '/v1/me/storefront')).toHaveLength(2)
  })

  it('getSongIsrcs (V8): hesap storefront’unda toplu sorgu; ISRC büyük harf; ISRC’siz şarkı null', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => String(1000 + i))
    const { api, requests } = setup((url) => {
      if (url.pathname === '/v1/me/storefront') return { data: [{ id: 'tr' }] }
      const asked = (url.searchParams.get('ids') ?? '').split(',')
      return {
        data: asked.map((id) => ({
          id,
          type: 'songs',
          attributes: id === '1001' ? {} : { isrc: id === '1000' ? 'gbum71029604' : `USAB1${id}00` }
        }))
      }
    })
    const map = await api.getSongIsrcs([...ids, '1000', 'i.kutuphane', '12a'])
    expect(map.get('1000')).toBe('GBUM71029604')
    expect(map.get('1001')).toBeNull()
    expect(map.size).toBe(150)
    const songCalls = requests.filter((r) => r.url.pathname === '/v1/catalog/tr/songs')
    expect(songCalls).toHaveLength(2) // 100 + 50
    expect(songCalls[0]!.url.searchParams.get('ids')!.split(',')).toHaveLength(100)
    expect(await api.getSongIsrcs(['i.x'])).toEqual(new Map())
  })

  it('giriş yoksa ve storefront verilmezse INVALID_ARGUMENT', async () => {
    const { api, requests } = setup(() => ({}), null)
    await expect(api.searchCatalog('x')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(requests).toHaveLength(0)
  })

  it('kütüphane araması library-* türlerini ister ve eşler', async () => {
    const { api, requests } = setup(() => ({
      results: {
        'library-songs': { data: [songResource('i.1')] },
        'library-playlists': { data: [playlistResource('p.1', 'Sabah')] }
      }
    }))
    const r = await api.searchLibrary('sabah', 3)
    expect(requests[0]!.url.searchParams.get('types')).toBe('library-songs,library-playlists')
    expect(requests[0]!.url.searchParams.get('limit')).toBe('3')
    expect(r.songs[0]!.id).toBe('i.1')
    expect(r.playlists[0]!.name).toBe('Sabah')
  })

  it('son çalınanlar limitle sınırlanır', async () => {
    const all = Array.from({ length: 50 }, (_, i) => songResource(`r${i}`))
    const { api } = setup((url) => paged(url, all))
    expect(await api.getRecentlyPlayed(40)).toHaveLength(40)
  })
})
