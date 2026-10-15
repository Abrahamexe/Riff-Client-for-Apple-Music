import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import { CatalogCacheRepository } from '../db/repositories/catalogCache'
import { CATALOG_TTL, CatalogService } from './catalogService'

// R2: liste sayfalarının kalıcı SWR önbelleği (catalog_cache, migration 15).

let db: Db
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function api(groups: { title: string }[][]) {
  return {
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    getCatalogPlaylist: vi.fn(),
    getRecommendations: vi.fn(async () => {
      const next = groups.shift()
      if (!next) throw new Error('ağ yok')
      return next as never
    }),
    getHeavyRotation: vi.fn(),
    getCharts: vi.fn(),
    getGenres: vi.fn(),
    getLiveStations: vi.fn(),
    getRecentStations: vi.fn(),
    getStationGenres: vi.fn(),
    getGenreStations: vi.fn(),
    getRecentlyAdded: vi.fn(async () => [] as never),
    getSongLinks: vi.fn(),
    searchGroups: vi.fn()
  }
}

describe('CatalogService kalıcı önbellek (R2)', () => {
  it('ilk okuma ağdan + diske; yeni süreç diskten anında (ağsız)', async () => {
    const store = new CatalogCacheRepository(db)
    const first = api([[{ title: 'A' }]])
    expect(await new CatalogService(first, () => 0, store).getRecommendations('tr')).toEqual([
      { title: 'A' }
    ])
    // Yeni süreç (bellek boş), süre dolmamış: ağa çıkmaz.
    const second = api([])
    const service = new CatalogService(second, () => 1000, store)
    expect(await service.getRecommendations('tr')).toEqual([{ title: 'A' }])
    expect(second.getRecommendations).not.toHaveBeenCalled()
  })

  it('süresi geçmiş kayıt anında döner, arka planda tazelenir; değiştiyse onRefreshed', async () => {
    const store = new CatalogCacheRepository(db)
    await new CatalogService(api([[{ title: 'A' }]]), () => 0, store).getRecommendations()
    const clock = { t: CATALOG_TTL.recommendations + 1 }
    const net = api([[{ title: 'B' }], [{ title: 'B' }]])
    const onRefreshed = vi.fn()
    const service = new CatalogService(net, () => clock.t, store, onRefreshed)
    // İkisi de anında eski kaydı alır; eşzamanlı okuma ikinci tazeleme başlatmaz.
    expect(await Promise.all([service.getRecommendations(), service.getRecommendations()])).toEqual(
      [[{ title: 'A' }], [{ title: 'A' }]]
    )
    await settle()
    expect(net.getRecommendations).toHaveBeenCalledTimes(1)
    expect(onRefreshed).toHaveBeenCalledTimes(1)
    expect(await service.getRecommendations()).toEqual([{ title: 'B' }])
    expect(store.get('1:recommendations:')?.fetchedAt).toBe(clock.t)
  })

  it('tazelenen içerik aynıysa onRefreshed çağrılmaz; ağ hatasında eski kayıt kalır', async () => {
    const store = new CatalogCacheRepository(db)
    await new CatalogService(api([[{ title: 'A' }]]), () => 0, store).getRecommendations()
    const late = CATALOG_TTL.recommendations + 1
    const onRefreshed = vi.fn()
    const same = new CatalogService(api([[{ title: 'A' }]]), () => late, store, onRefreshed)
    await same.getRecommendations()
    await settle()
    expect(onRefreshed).not.toHaveBeenCalled()
    const offline = new CatalogService(api([]), () => 3 * late, store, onRefreshed)
    expect(await offline.getRecommendations()).toEqual([{ title: 'A' }])
    await settle()
    expect(store.get('1:recommendations:')?.value).toEqual([{ title: 'A' }])
  })

  it('çıkış (clear) diski de siler; süren tazeleme sonucu yazılmaz', async () => {
    const store = new CatalogCacheRepository(db)
    await new CatalogService(api([[{ title: 'A' }]]), () => 0, store).getRecommendations()
    let release: (v: { title: string }[]) => void = () => {}
    const slow = api([])
    slow.getRecommendations.mockImplementationOnce(
      () => new Promise((r) => (release = r as typeof release)) as never
    )
    const service = new CatalogService(slow, () => CATALOG_TTL.recommendations + 1, store)
    await service.getRecommendations()
    service.clear()
    release([{ title: 'kişisel' }])
    await settle()
    expect(store.get('1:recommendations:')).toBeNull()
  })

  it('Son Eklenenler kalıcı değil; bozuk kayıt silinir ve yok sayılır', async () => {
    const store = new CatalogCacheRepository(db)
    await new CatalogService(api([]), () => 0, store).getRecentlyAdded(10)
    expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_cache').get()).toEqual({ n: 0 })
    db.prepare("INSERT INTO catalog_cache (key, value, fetched_at) VALUES ('x', '{bozuk', 0)").run()
    expect(store.get('x')).toBeNull()
    expect(db.prepare('SELECT COUNT(*) AS n FROM catalog_cache').get()).toEqual({ n: 0 })
  })
})
