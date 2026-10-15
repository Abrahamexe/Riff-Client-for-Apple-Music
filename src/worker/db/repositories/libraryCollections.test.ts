import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { track } from '../../testing'
import { openDatabase, type Db } from '../connection'
import { LibraryCollectionsRepository } from './libraryCollections'

// A4: büyük listenin geçici tabloya parça parça yazılıp tek transaction'da takası. Küçük
// `chunkSize` ile aynı yol 5 öğede sınanır (ölçüm: sync/largeLibrary.test.ts).

let db: Db
let repo: LibraryCollectionsRepository
beforeEach(() => {
  db = openDatabase(':memory:')
  repo = new LibraryCollectionsRepository(db)
})
afterEach(() => db.close())

const songs = (n: number, prefix = 's') =>
  Array.from({ length: n }, (_, i) => track(`${prefix}${i}`, { name: `Ad ${(i * 3) % n}` }))
const schema = () =>
  db
    .prepare(
      "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
const stageTables = () =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE name IN ('library_song_stage', 'library_album_stage', 'library_artist_stage')"
    )
    .all()

describe('LibraryCollectionsRepository — parçalı yer değiştirme (A4)', () => {
  it('parçalı yazma doğrudan yazmayla aynı sonucu verir; şema (indeksler) korunur, geçici tablo kalmaz', async () => {
    const before = schema()
    const yields: number[] = []
    expect(
      await repo.replaceSongs(songs(5), {
        chunkSize: 2,
        yieldFn: async () => void yields.push(repo.count('library_song'))
      })
    ).toBe(true)
    // Parçalar arasında okuyan eski (boş) tabloyu görür: yarım kütüphane görünmez.
    expect(yields).toEqual([0, 0, 0])
    const staged = repo.songs(0, 10, 'name')

    expect(await repo.replaceSongs(songs(5))).toBe(true) // doğrudan yol
    expect(repo.songs(0, 10, 'name')).toEqual(staged)
    expect(repo.songs(0, 10, 'recent').map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(schema()).toEqual(before)
    expect(stageTables()).toEqual([])
  })

  it('arada isCurrent false → yazma bırakılır, eski veri kalır, geçici tablo silinir', async () => {
    await repo.replaceSongs(songs(3, 'old'))
    let calls = 0
    expect(await repo.replaceSongs(songs(5), { chunkSize: 2, isCurrent: () => ++calls < 3 })).toBe(
      false
    )
    expect(repo.songs(0, 10, 'recent').map((s) => s.id)).toEqual(['old0', 'old1', 'old2'])
    expect(stageTables()).toEqual([])
  })

  it('başta isCurrent false → hiç yazılmaz', async () => {
    expect(await repo.replaceSongs(songs(1), { isCurrent: () => false })).toBe(false)
    expect(repo.count('library_song')).toBe(0)
  })

  it('çıkış (clear) yarım kalmış geçici tabloyu da siler (kütüphane verisi taşır)', async () => {
    let cleared = false
    const done = repo.replaceAlbums(
      Array.from({ length: 4 }, (_, i) => ({
        id: `a${i}`,
        name: `Albüm ${i}`,
        artistName: 'S',
        trackCount: 1,
        playParams: null,
        artworkUrl: null
      })),
      {
        chunkSize: 2,
        yieldFn: async () => {
          if (!cleared) {
            cleared = true
            expect(stageTables()).toHaveLength(1)
            repo.clear()
          }
        },
        isCurrent: () => !cleared
      }
    )
    expect(await done).toBe(false)
    expect(stageTables()).toEqual([])
    expect(repo.count('library_album')).toBe(0)
  })

  it('yazma hatasında geçici tablo silinir, eski veri kalır', async () => {
    await repo.replaceArtists([{ id: 'r0', name: 'Eski', artworkUrl: null }])
    const bad = [
      { id: 'r1', name: 'A', artworkUrl: null },
      { id: 'r2', name: null as unknown as string, artworkUrl: null }, // NOT NULL ihlali
      { id: 'r3', name: 'C', artworkUrl: null }
    ]
    await expect(repo.replaceArtists(bad, { chunkSize: 1 })).rejects.toThrow()
    expect(repo.artists(0, 10).map((a) => a.id)).toEqual(['r0'])
    expect(stageTables()).toEqual([])
  })
})

describe('Türler, Besteciler, Derlemeler (§3.6)', () => {
  const song = (id: string, genre: string | null, composer: string | null, name = id) => ({
    ...track(id, { name }),
    genre,
    composer
  })
  const album = (id: string, compilation: boolean) => ({
    id,
    name: `Albüm ${id}`,
    artistName: 'Çeşitli',
    trackCount: 10,
    playParams: null,
    artworkUrl: null,
    compilation
  })

  beforeEach(async () => {
    await repo.replaceSongs([
      song('a', 'Hip-Hop/Rap', 'Ye, Mike Dean', 'B şarkı'),
      song('b', 'hip-hop/rap', 'ye & 88-Keys', 'A şarkı'),
      song('c', 'Pop', null),
      song('d', null, 'Max Martin 100%_x')
    ])
    await repo.replaceAlbums([album('1', true), album('2', false), album('3', true)])
  })

  it('türler sayılarıyla (büyük/küçük harf aynı tür)', () => {
    expect(repo.genres()).toEqual([
      { name: expect.stringMatching(/^hip-hop\/rap$/i), count: 2 },
      { name: 'Pop', count: 1 }
    ])
  })

  it('besteciler kişi kişi; besteci şarkıları birebir adla, sayfalı', () => {
    expect(repo.composers().map((c) => [c.name, c.count])).toEqual([
      ['88-Keys', 1],
      ['Max Martin 100%_x', 1],
      ['Mike Dean', 1],
      ['Ye', 2]
    ])
    const ye = repo.filteredSongs({ composer: 'YE' }, 0, 10, 'name')
    expect(ye.total).toBe(2)
    expect(ye.items.map((t) => t.id)).toEqual(['b', 'a'])
    expect(repo.filteredSongs({ composer: 'Ye' }, 1, 10).items.map((t) => t.id)).toEqual(['a'])
    // LIKE özel karakterleri kaçırılır; ad parçası eşleşmez.
    expect(repo.filteredSongs({ composer: 'Max Martin 100%_x' }, 0, 10).total).toBe(1)
    expect(repo.filteredSongs({ composer: 'Mike' }, 0, 10).total).toBe(0)
  })

  it('tür şarkıları ve derlemeler toplamlarıyla', () => {
    const rap = repo.filteredSongs({ genre: 'HIP-HOP/RAP' }, 0, 1, 'name')
    expect(rap).toEqual({ items: [expect.objectContaining({ id: 'b' })], total: 2 })
    const comp = repo.compilations(0, 10)
    expect(comp.total).toBe(2)
    expect(comp.items.map((a) => a.id)).toEqual(['1', '3'])
  })
})
