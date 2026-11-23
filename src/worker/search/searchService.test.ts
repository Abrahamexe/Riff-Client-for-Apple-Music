import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '@shared/errors'
import { SearchSuggestionsSchema, UnifiedSearchSchema } from '@shared/ipc-contract'
import { openDatabase, type Db } from '../db/connection'
import { AppleMusicApi } from '../net/appleApi'
import { songResource } from '../testing'
import { MAX_RECENT_SEARCHES, SearchService } from './searchService'

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

const catalogBody = {
  results: {
    songs: { data: [{ ...songResource('1440806041'), type: 'songs' }] },
    albums: {
      data: [
        {
          id: '1440806023',
          type: 'albums',
          attributes: {
            name: 'A Night at the Opera',
            artistName: 'Queen',
            trackCount: 12,
            playParams: { id: '1440806023', kind: 'album' },
            artwork: { url: 'https://is1-ssl.mzstatic.com/a/{w}x{h}.jpg' }
          }
        }
      ]
    },
    artists: { data: [{ id: '3296287', type: 'artists', attributes: { name: 'Queen' } }] },
    playlists: { data: [] },
    stations: {
      data: [
        { id: 'ra.1', type: 'stations', attributes: { name: 'Queen İstasyonu', isLive: false } }
      ]
    },
    // P2 gözlemi: `with=topResults` → `results.topResults.data`, türler karışık.
    topResults: {
      data: [
        { id: '3296287', type: 'artists', attributes: { name: 'Queen' } },
        { ...songResource('1440806041'), type: 'songs' },
        { id: 'mv1', type: 'music-videos', attributes: { name: 'Klip' } }
      ]
    }
  }
}
// P2 gözlemi: `results.suggestions[]` = terms | topResults (content: kaynak).
const suggestionsBody = {
  results: {
    suggestions: [
      { kind: 'terms', searchTerm: 'queen', displayTerm: 'queen', source: '7' },
      { kind: 'terms', searchTerm: 'queen bohemian', displayTerm: 'queen bohemian' },
      { kind: 'terms', searchTerm: 42 },
      {
        kind: 'topResults',
        content: { id: '3296287', type: 'artists', attributes: { name: 'Queen' } }
      },
      {
        kind: 'topResults',
        content: { id: 'mv1', type: 'music-videos', attributes: { name: 'Klip' } }
      },
      { kind: 'bilinmeyen' }
    ]
  }
}
const libraryBody = {
  results: { 'library-songs': { data: [songResource('i.abc')] } }
}

interface Call {
  url: URL
  signal: AbortSignal | undefined
}

/** Sahte Apple: `hold` verilen terimde yanıt iptale (veya `release`) kadar bekler. */
function setup({ signedIn = true, failLibrary = false } = {}) {
  const calls: Call[] = []
  const held = new Map<string, () => void>()
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    calls.push({ url, signal: init?.signal ?? undefined })
    if (url.pathname === '/v1/me/storefront') return json({ data: [{ id: 'tr' }] })
    const term = url.searchParams.get('term') ?? ''
    if (term.startsWith('yavaş')) {
      await new Promise<void>((resolve, reject) => {
        held.set(term, resolve)
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('iptal', 'AbortError'))
        )
      })
    }
    if (url.pathname === '/v1/me/library/search') {
      return failLibrary ? new Response('', { status: 500 }) : json(libraryBody)
    }
    if (url.pathname.endsWith('/search/suggestions')) return json(suggestionsBody)
    return json(catalogBody)
  }) as typeof globalThis.fetch
  const api = new AppleMusicApi({
    fetch,
    getDeveloperToken: async () => 'dev',
    getUserToken: () => (signedIn ? 'user' : null),
    retry: { retries: 0, sleep: async () => {} }
  })
  const clock = { t: 1_000 }
  const service = new SearchService(db, api, () => clock.t)
  return { service, calls, held, clock }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

describe('SearchService (3.B1)', () => {
  it('katalog + kütüphane tek çağrıda, türe göre gruplu; sözleşmeye uyar', async () => {
    const { service, calls } = setup()
    const res = await service.search({ term: 'queen' })
    expect(UnifiedSearchSchema.safeParse(res).success).toBe(true)
    expect(res.catalog?.songs.map((s) => s.id)).toEqual(['1440806041'])
    expect(res.catalog?.albums[0]).toMatchObject({ name: 'A Night at the Opera', trackCount: 12 })
    expect(res.catalog?.artists[0]).toMatchObject({ id: '3296287', name: 'Queen' })
    expect(res.catalog?.stations.map((s) => `${s.kind}:${s.id}`)).toEqual(['station:ra.1'])
    expect(res.library?.songs.map((s) => s.id)).toEqual(['i.abc'])
    expect(res.library?.albums).toEqual([])
    expect(res.library?.stations).toEqual([])
    const catalog = calls.find((c) => c.url.pathname === '/v1/catalog/tr/search')!
    expect(catalog.url.searchParams.get('types')).toBe('songs,albums,artists,playlists,stations')
    expect(catalog.url.searchParams.get('l')).toBeNull()
    const library = calls.find((c) => c.url.pathname === '/v1/me/library/search')!
    expect(library.url.searchParams.get('types')).toBe(
      'library-songs,library-albums,library-artists,library-playlists'
    )
  })

  it('kapsam: yalnızca katalog veya yalnızca kütüphane', async () => {
    const { service } = setup()
    const onlyCatalog = await service.search({ term: 'queen', scope: 'catalog' })
    expect(onlyCatalog.library).toBeNull()
    expect(onlyCatalog.catalog).not.toBeNull()
    const onlyLibrary = await service.search({ term: 'queen', scope: 'library' })
    expect(onlyLibrary.catalog).toBeNull()
  })

  it('bir kaynak başarısız olursa diğeri yine döner; hata ilgili alanda', async () => {
    const { service } = setup({ failLibrary: true })
    const res = await service.search({ term: 'queen' })
    expect(res.catalog?.songs).toHaveLength(1)
    expect(res.library).toBeNull()
    expect(res.libraryError).toMatchObject({ code: 'SERVER_ERROR' })
    expect(res.catalogError).toBeNull()
  })

  it('hızlı ardışık aramada yalnızca son istek tamamlanır; öncekinin ağ isteği iptal edilir', async () => {
    const { service, calls } = setup()
    const first = service.search({ term: 'yavaş q' })
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.url.searchParams.get('term') === 'yavaş q')).toHaveLength(2)
    )
    const second = await service.search({ term: 'queen' })
    await expect(first).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    expect(second.catalog?.songs).toHaveLength(1)
    const old = calls.filter((c) => c.url.searchParams.get('term') === 'yavaş q')
    expect(old.every((c) => c.signal?.aborted)).toBe(true)
  })

  it('giriş yoksa ağa çıkmadan NOT_SIGNED_IN', async () => {
    const { service, calls } = setup({ signedIn: false })
    const err = await service.search({ term: 'queen' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CoreError)
    expect((err as CoreError).code).toBe('NOT_SIGNED_IN')
    expect(calls).toHaveLength(0)
  })

  it('son aramalar: en yeni önce, tekrar en üste, büyük/küçük harf duyarsız, sınırlı; temizlenir', () => {
    const { service, clock } = setup()
    for (const term of ['queen', 'tarkan', 'QUEEN ']) {
      clock.t += 1
      service.addRecent(term)
    }
    expect(service.recent().map((r) => r.term)).toEqual(['QUEEN', 'tarkan'])
    for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) {
      clock.t += 1
      service.addRecent(`terim ${i}`)
    }
    const recent = service.recent(50)
    expect(recent).toHaveLength(MAX_RECENT_SEARCHES)
    expect(recent[0]!.term).toBe(`terim ${MAX_RECENT_SEARCHES + 4}`)
    service.clear()
    expect(service.recent()).toEqual([])
  })

  it('P2: katalogda "En iyi sonuçlar" (with=topResults) kart olarak; desteklenmeyen tür atlanır; kütüphanede boş', async () => {
    const { service, calls } = setup()
    const result = await service.search({ term: 'queen' })
    expect(result.catalog!.top.map((c) => `${c.kind}:${c.id}`)).toEqual([
      'artist:3296287',
      'song:1440806041'
    ])
    expect(result.library!.top).toEqual([])
    const catalogCall = calls.find((c) => c.url.pathname === '/v1/catalog/tr/search')!
    const libraryCall = calls.find((c) => c.url.pathname === '/v1/me/library/search')!
    expect(catalogCall.url.searchParams.get('with')).toBe('topResults')
    expect(libraryCall.url.searchParams.has('with')).toBe(false)
  })
})

describe('SearchService.suggest (PLAN_v5 P2)', () => {
  it('terimler + en iyi eşleşmeler; bozuk/desteklenmeyen öğe atlanır; sözleşmeye uyar', async () => {
    const { service, calls } = setup()
    const s = await service.suggest({ term: 'que' })
    expect(s.term).toBe('que')
    expect(s.terms).toEqual([
      { searchTerm: 'queen', displayTerm: 'queen' },
      { searchTerm: 'queen bohemian', displayTerm: 'queen bohemian' }
    ])
    expect(s.top.map((c) => `${c.kind}:${c.id}`)).toEqual(['artist:3296287'])
    expect(SearchSuggestionsSchema.safeParse(s).success).toBe(true)
    const call = calls.find((c) => c.url.pathname === '/v1/catalog/tr/search/suggestions')!
    expect(Object.fromEntries(call.url.searchParams)).toMatchObject({
      term: 'que',
      kinds: 'terms,topResults',
      types: 'songs,albums,artists,playlists',
      limit: '5'
    })
  })

  it('yeni öneri isteği süreni iptal eder (REQUEST_CANCELLED); aramayı etkilemez', async () => {
    const { service, calls } = setup()
    const slow = service.suggest({ term: 'yavaş' })
    const slowCheck = expect(slow).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.searchParams.get('term') === 'yavaş')).toBe(true)
    )
    const search = service.search({ term: 'queen' })
    expect((await service.suggest({ term: 'que' })).terms).toHaveLength(2)
    await slowCheck
    expect(calls.find((c) => c.url.searchParams.get('term') === 'yavaş')!.signal!.aborted).toBe(
      true
    )
    expect((await search).catalog).not.toBeNull()
  })

  it('giriş yoksa ağa çıkmadan NOT_SIGNED_IN', async () => {
    const { service, calls } = setup({ signedIn: false })
    await expect(service.suggest({ term: 'que' })).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    expect(calls).toHaveLength(0)
  })
})
