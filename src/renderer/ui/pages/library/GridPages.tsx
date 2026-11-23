import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Album, Artist, Card, LibrarySort, Playlist } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'
import { CardGrid, type GridItem } from '../../components/CardGrid'
import { useGo } from '../../shell/scroll'
import { cardRoute } from '../../components/cardRoute'
import { PageHeader, SortPicker, useScopeVersion } from './common'
import { albumCard, artistCard, playlistCard } from '../searchCards'

// Kapak ızgaralı arşiv sayfaları (B4): Albümler, Sanatçılar, Son Eklenenler, Tüm Çalma Listeleri.
// Albüm ve sanatçılar kaydırdıkça 100'er yüklenir (binlerce öğe); kart kapağı sayfa başlığına büyür.

const PAGE = 100

/** Kaydırdıkça sonraki sayfayı yükler (listenin sonundaki gözcü). */
function useIncremental<T>(
  load: (offset: number) => Promise<{ items: T[]; total: number }>,
  deps: unknown[]
): { items: T[]; sentinel: RefObject<HTMLDivElement | null> } {
  const [items, setItems] = useState<T[]>([])
  const state = useRef({ offset: 0, total: Infinity, loading: false, generation: 0 })
  const sentinel = useRef<HTMLDivElement>(null)

  const more = (): void => {
    const s = state.current
    if (s.loading || s.offset >= s.total) return
    s.loading = true
    const generation = s.generation
    void load(s.offset)
      .then((page) => {
        if (generation !== state.current.generation) return
        s.offset += page.items.length
        s.total = page.items.length === 0 ? s.offset : page.total
        setItems((prev) => [...prev, ...page.items])
      })
      .catch(() => {})
      .finally(() => {
        s.loading = false
      })
  }

  // Bağımlılıklar (sıralama, senkron sürümü) çağırandan gelir: değişince baştan yüklenir.
  const depsKey = JSON.stringify(deps.map((d) => (typeof d === 'object' ? 0 : d)))
  useEffect(() => {
    state.current = {
      offset: 0,
      total: Infinity,
      loading: false,
      generation: state.current.generation + 1
    }
    setItems([])
    more()
  }, [depsKey])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) more()
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  })

  return { items, sentinel }
}

export function AlbumsPage() {
  const app = useApp()
  const go = useGo()
  const [sort, setSort] = useState<LibrarySort>('name')
  const version = useScopeVersion('albums')
  const { items, sentinel } = useIncremental<Album>(
    (offset) => app.library.getLibraryAlbums({ offset, limit: PAGE, sort }),
    [app, sort, version]
  )
  const grid: GridItem[] = items.map((a) => ({
    key: a.id,
    title: a.name,
    subtitle: a.artistName,
    artworkUrl: a.artworkUrl,
    kind: 'album',
    ...(a.explicit ? { explicit: true } : {}),
    card: albumCard(a),
    onOpen: () => go({ name: 'album', id: a.id, title: a.name, artworkUrl: a.artworkUrl })
  }))
  return (
    <>
      <PageHeader title={i18n.t('library.albums')}>
        <SortPicker value={sort} options={['name', 'artist', 'recent']} onChange={setSort} />
      </PageHeader>
      <CardGrid items={grid} />
      <div ref={sentinel} className="sentinel" />
    </>
  )
}

export function ArtistsPage() {
  const app = useApp()
  const go = useGo()
  const [sort, setSort] = useState<LibrarySort>('name')
  const version = useScopeVersion('artists')
  const { items, sentinel } = useIncremental<Artist>(
    (offset) => app.library.getLibraryArtists({ offset, limit: PAGE, sort }),
    [app, sort, version]
  )
  const grid: GridItem[] = items.map((a) => ({
    key: a.id,
    title: a.name,
    subtitle: '',
    artworkUrl: a.artworkUrl,
    kind: 'artist',
    card: artistCard(a),
    onOpen: () => go({ name: 'artist', id: a.id, title: a.name })
  }))
  return (
    <>
      <PageHeader title={i18n.t('nav.artists')}>
        <SortPicker value={sort} options={['name', 'recent']} onChange={setSort} />
      </PageHeader>
      <CardGrid items={grid} />
      <div ref={sentinel} className="sentinel" />
    </>
  )
}

export function RecentlyAddedPage() {
  const app = useApp()
  const go = useGo()
  const [cards, setCards] = useState<Card[]>([])
  const version = useScopeVersion('albums')
  useEffect(() => {
    void app.library
      .getRecentlyAdded(100)
      .then(setCards)
      .catch(() => {})
  }, [app, version])
  const grid: GridItem[] = cards.map((c) => {
    const route = cardRoute(c)
    return {
      key: `${c.kind}:${c.id}`,
      title: c.name,
      subtitle: c.subtitle,
      artworkUrl: c.artworkUrl,
      kind: c.kind === 'station' ? 'album' : c.kind,
      ...(c.explicit ? { explicit: true } : {}),
      card: c,
      onOpen: () => {
        if (route) go(route)
      }
    }
  })
  return (
    <>
      <PageHeader title={i18n.t('nav.recentlyAdded')} />
      <CardGrid items={grid} />
    </>
  )
}

export function PlaylistsPage() {
  const app = useApp()
  const go = useGo()
  const [items, setItems] = useState<Playlist[]>([])
  const version = useScopeVersion('playlists')
  useEffect(() => {
    void app.library
      .getPlaylists()
      .then((v) => setItems(v.items))
      .catch(() => {})
  }, [app, version])
  const grid: GridItem[] = items.map((p) => ({
    key: p.id,
    title: p.name,
    subtitle: '',
    artworkUrl: p.artworkUrl,
    kind: 'playlist',
    card: playlistCard(p),
    onOpen: () =>
      go({
        name: 'playlist',
        id: p.id,
        title: p.name,
        artworkUrl: p.artworkUrl,
        description: p.description
      })
  }))
  return (
    <>
      <PageHeader title={i18n.t('nav.allPlaylists')} />
      <CardGrid items={grid} />
    </>
  )
}
