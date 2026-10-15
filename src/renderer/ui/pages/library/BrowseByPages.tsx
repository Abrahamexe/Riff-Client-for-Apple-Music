import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Play, Shuffle } from 'lucide-react'
import type { Album, LibrarySort, Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'
import { usePlayer } from '../../hooks/usePlayer'
import { CardGrid, type GridItem } from '../../components/CardGrid'
import { playableId, TrackTable } from '../../components/TrackTable'
import { useGo } from '../../shell/scroll'
import { useTrackMenu } from '../../overlays/itemMenus'
import { albumCard } from '../searchCards'
import { PageHeader, SortPicker, useScopeVersion } from './common'

// Arşiv → Türler, Besteciler, Derlemeler (§3.6, geliştirici kararları 2026-10-14): liste (ad + şarkı
// sayısı) → basınca o türün / bestecinin şarkıları Şarkılar tablosuyla (Çal / Karıştır). Besteciler
// kişi kişi ayrılmış (worker). Derlemeler Apple katalog `isCompilation` albümleri.

/** Çal / Karıştır'da kuyruğa alınan en fazla şarkı (MusicKit istek boyutu; playlistWindow.ts). */
const QUEUE_LIMIT = 300

type NamedKind = 'genres' | 'composers'

export function NamedListPage({ kind }: { kind: NamedKind }) {
  const app = useApp()
  const go = useGo()
  const version = useScopeVersion('songs')
  const [items, setItems] = useState<{ name: string; count: number }[] | null>(null)

  useEffect(() => {
    const load =
      kind === 'genres' ? app.library.getLibraryGenres() : app.library.getLibraryComposers()
    void load.then((r) => setItems(r.items)).catch(() => setItems([]))
  }, [app, kind, version])

  return (
    <>
      <PageHeader title={i18n.t(kind === 'genres' ? 'nav.genres' : 'nav.composers')} />
      {items && items.length === 0 && (
        <p className="page-message">
          {i18n.t(kind === 'genres' ? 'library.noGenres' : 'library.noComposers')}
        </p>
      )}
      <div className="named-list">
        {items?.map((it) => (
          <button
            key={it.name}
            type="button"
            className="named-list__row"
            onClick={() =>
              go(
                kind === 'genres'
                  ? { name: 'genre', genre: it.name }
                  : { name: 'composer', composer: it.name }
              )
            }
          >
            <span className="named-list__name">{it.name}</span>
            <span className="named-list__count">
              {i18n.t('collection.songCount', { count: it.count })}
            </span>
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  )
}

export function FilteredSongsPage({
  filter
}: {
  filter: { genre: string } | { composer: string }
}) {
  const app = useApp()
  const trackMenu = useTrackMenu()
  const { player } = usePlayer()
  const [sort, setSort] = useState<LibrarySort>('name')
  const [total, setTotal] = useState(0)
  const version = useScopeVersion('songs')
  const title = 'genre' in filter ? filter.genre : filter.composer
  const filterKey = JSON.stringify(filter)

  useEffect(() => {
    void app.library
      .getFilteredSongs(filter, { limit: 1, sort })
      .then((p) => setTotal(p.total))
      .catch(() => {})
    // `filter` nesnesi her çizimde yeni: anahtarıyla izlenir.
  }, [app, filterKey, sort, version])

  const loadPage = useCallback(
    (offset: number, limit: number) =>
      app.library.getFilteredSongs(filter, { offset, limit, sort }).then((p) => p.items),
    [app, filterKey, sort]
  )
  /** Basılan şarkıdan başlayan dilim kuyruğa alınır (listenin sırası korunur). */
  const playFrom = useCallback(
    (index: number) => {
      if (!player) return
      void app.library
        .getFilteredSongs(filter, { offset: index, limit: QUEUE_LIMIT, sort })
        .then((p) => player.playSongs(p.items.map(playableId), 0))
        .catch(() => {})
    },
    [app, player, filterKey, sort]
  )

  return (
    <>
      <PageHeader title={title}>
        <SortPicker value={sort} options={['name', 'artist', 'recent']} onChange={setSort} />
      </PageHeader>
      <div className="collection-header__actions browse-by__actions">
        <span className="collection-header__meta">
          {i18n.t('collection.songCount', { count: total })}
        </span>
        <button
          type="button"
          className="pill-button pill-button--primary"
          disabled={!player || total === 0}
          onClick={() => playFrom(0)}
        >
          <Play size={16} fill="currentColor" aria-hidden="true" />
          {i18n.t('collection.play')}
        </button>
        <button
          type="button"
          className="pill-button"
          disabled={!player || total === 0}
          onClick={() => {
            player?.setShuffle(true)
            playFrom(0)
          }}
        >
          <Shuffle size={16} aria-hidden="true" />
          {i18n.t('collection.shuffle')}
        </button>
      </div>
      <TrackTable
        total={total}
        resetKey={`${filterKey}:${sort}:${version}`}
        loadPage={loadPage}
        onPlay={(_t: Track, i: number) => playFrom(i)}
        menu={(t) => trackMenu(t)}
      />
    </>
  )
}

export function CompilationsPage() {
  const app = useApp()
  const go = useGo()
  const version = useScopeVersion('albums')
  const [items, setItems] = useState<Album[] | null>(null)

  useEffect(() => {
    void app.library
      .getLibraryCompilations({ limit: 500 })
      .then((p) => setItems(p.items))
      .catch(() => setItems([]))
  }, [app, version])

  const grid: GridItem[] = (items ?? []).map((a) => ({
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
      <PageHeader title={i18n.t('nav.compilations')} />
      {items && items.length === 0 && (
        <p className="page-message">{i18n.t('library.noCompilations')}</p>
      )}
      <CardGrid items={grid} />
    </>
  )
}
