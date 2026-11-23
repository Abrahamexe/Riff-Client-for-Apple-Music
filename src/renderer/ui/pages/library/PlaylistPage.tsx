import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Play, Shuffle } from 'lucide-react'
import type { PlaylistSort, Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'
import { usePlayer } from '../../hooks/usePlayer'
import { Artwork } from '../../components/Artwork'
import { PageTint } from '../../components/PageTint'
import { TrackTable } from '../../components/TrackTable'
import { playlistStart } from '../../components/playlistWindow'
import { useScopeVersion } from './common'
import { trackTargets, useCardMenu, useTrackMenu } from '../../overlays/itemMenus'
import { MoreButton } from '../../overlays/MoreButton'
import { isDefaultSort, loadPlaylistSort, savePlaylistSort } from './playlistSort'
import { PlaylistSortButton } from './PlaylistSortButton'
import { PlaylistSearch, useDebounced } from '../../components/PlaylistSearch'

// Çalma listesi sayfası (B4): Apple Music gibi büyük kapak, ad, açıklama, Çal / Karıştır ve şarkı
// tablosu (sanal; binlerce şarkı). Kapak, açıldığı karttan büyüyerek gelir (kapaktan büyüme).
// "Sırala" menüsü: playlist sırası / ad / sanatçı / albüm / süre, artan ya da azalan; her playlist
// kendi seçimini hatırlar (playlistSort.ts). Sıralı görünümde çalma, görünen sırayla kuyruğa alınır.
// Liste içinde arama (2026-10-18): süzme worker'da; süzülmüş görünümde de çalma görünen sırayla.

export function PlaylistPage({
  id,
  title,
  artworkUrl,
  description
}: {
  id: string
  title: string
  artworkUrl: string | null
  description?: string
}) {
  const cardMenu = useCardMenu()
  const trackMenu = useTrackMenu()
  const app = useApp()
  const { player } = usePlayer()
  const [total, setTotal] = useState(0)
  /** Süzülmüş görünümdeki şarkı sayısı (arama yokken `total`). */
  const [shown, setShown] = useState(0)
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const version = useScopeVersion('playlists')
  const [sort, setSortState] = useState<PlaylistSort>(() =>
    loadPlaylistSort(id, window.localStorage)
  )
  // Sıralı ya da süzülmüş görünüm Apple'ın liste sırası değil: çalma görünen sırayla.
  const sorted = !isDefaultSort(sort) || query !== ''
  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    savePlaylistSort(id, next, window.localStorage)
  }

  useEffect(() => {
    const count = (): void => {
      void app.library
        .getPlaylistTracks(id, { offset: 0, limit: 1 })
        .then((p) => setTotal(p.total))
        .catch(() => {})
    }
    count()
    const off = app.library.onChanged((s) => {
      if (s.scope === 'playlistTracks' && s.playlistId === id) count()
    })
    return off
  }, [app, id, version])

  useEffect(() => {
    if (query === '') {
      setShown(total)
      return
    }
    let live = true
    void app.library
      .getPlaylistTracks(id, { offset: 0, limit: 1, query })
      .then((p) => live && setShown(p.total))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [app, id, query, total])

  const loadPage = useCallback(
    (offset: number, limit: number) =>
      app.library
        .getPlaylistTracks(id, { offset, limit, sort, ...(query ? { query } : {}) })
        .then((p) => p.items),
    [app, id, sort, query]
  )
  const playFrom = useCallback(
    (index: number, track?: Track) => {
      if (!player) return
      const plan = playlistStart(index, shown, sorted)
      if (plan.kind === 'playlist') {
        void player.playPlaylist(id, index, track ? trackTargets(track) : undefined).catch(() => {})
        return
      }
      // MusicKit liste kuyruğu ilk 100 şarkıyla sınırlı (ve Apple sırasıyla): basılan şarkıdan dilim.
      void app.library
        .getPlaylistTracks(id, {
          offset: plan.offset,
          limit: plan.limit,
          sort,
          ...(query ? { query } : {})
        })
        .then((p) =>
          player.playSongs(
            p.items.map((t) => t.id),
            plan.start
          )
        )
        .catch(() => {})
    },
    [app, player, id, shown, sorted, sort, query]
  )
  const shuffle = (): void => {
    if (!player) return
    player.setShuffle(true)
    playFrom(0)
  }

  return (
    <>
      <PageTint artwork={artworkUrl} />
      <div className="collection-header">
        <Artwork url={artworkUrl} size={480} kind="playlist" className="collection-header__art" />
        <motion.div
          className="collection-header__info"
          initial={{ opacity: 0, x: -12 }}
          animate={{
            opacity: 1,
            x: 0,
            transition: { delay: 0.12, type: 'spring', stiffness: 260, damping: 26 }
          }}
        >
          <h1 className="collection-header__title">{title}</h1>
          {description && <p className="collection-header__desc">{description}</p>}
          <p className="collection-header__meta">
            {i18n.t('collection.songCount', { count: total })}
          </p>
          <div className="collection-header__actions">
            <button
              type="button"
              className="pill-button pill-button--primary"
              disabled={!player || shown === 0}
              onClick={() => playFrom(0)}
            >
              <Play size={16} fill="currentColor" aria-hidden="true" />
              {i18n.t('collection.play')}
            </button>
            <button
              type="button"
              className="pill-button"
              disabled={!player || shown === 0}
              onClick={shuffle}
            >
              <Shuffle size={16} aria-hidden="true" />
              {i18n.t('collection.shuffle')}
            </button>
            <PlaylistSortButton value={sort} onChange={setSort} />
            <MoreButton
              className="header-more"
              build={() =>
                cardMenu({
                  kind: 'playlist',
                  id,
                  name: title,
                  subtitle: '',
                  artworkUrl,
                  playParams: null
                })
              }
            />
            <span className="collection-header__search">
              <PlaylistSearch value={search} onChange={setSearch} />
            </span>
          </div>
        </motion.div>
      </div>
      {query !== '' && shown === 0 && (
        <p className="playlist-search__empty">{i18n.t('playlist.noMatches')}</p>
      )}
      <TrackTable
        total={shown}
        resetKey={`${id}:${version}:${sort.by}:${sort.dir}:${query}`}
        loadPage={loadPage}
        onPlay={(t, i) => playFrom(i, t)}
        menu={(t) => trackMenu(t, { id })}
      />
    </>
  )
}
