import { useCallback, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Play, Plus, Shuffle } from 'lucide-react'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { Artwork } from '../components/Artwork'
import { PageTint } from '../components/PageTint'
import { ExpandableNote, LoadFailed, RowsSkeleton, Sections } from '../components/Sections'
import { TrackTable } from '../components/TrackTable'
import { playlistStart } from '../components/playlistWindow'
import { totalMinutes } from '../format'
import { trackIds, trackTargets, useCardMenu, useTrackMenu } from '../overlays/itemMenus'
import { MoreButton } from '../overlays/MoreButton'
import { PlaylistSortButton } from './library/PlaylistSortButton'
import { PlaylistSearch, useDebounced } from '../components/PlaylistSearch'
import { filterTracks } from '@shared/trackQuery'
import type { PlaylistSort } from '@shared/ipc-contract'
import {
  isDefaultSort,
  loadPlaylistSort,
  savePlaylistSort,
  sortTracks
} from './library/playlistSort'

// Apple'ın çalma listesi (B5; `pl.…`: Sana Özel Listeler, sanatçı listeleri, Göz At): kütüphane
// listesi sayfasıyla aynı düzen + küratör, Apple açıklaması ("DAHA FAZLA"), Arşive Ekle ve Apple'ın
// "Öne Çıkan Sanatçılar" rafı. Şarkılar bir kez gelir (Apple sayfalarıyla), tablo yine sanal.

export function CatalogPlaylistPage({
  id,
  title,
  artworkUrl
}: {
  id: string
  title: string
  artworkUrl: string | null
}) {
  const cardMenu = useCardMenu()
  const trackMenu = useTrackMenu()
  const app = useApp()
  const { player } = usePlayer()
  const load = useCallback(
    (locale: Parameters<typeof app.library.getCatalogPlaylist>[1]) =>
      app.library.getCatalogPlaylist(id, locale),
    [app, id]
  )
  const { remote, reload } = useRemote(load, `catalogPlaylist:${id}`)
  const detail = remote.state === 'ready' ? remote.value : null
  const [sort, setSortState] = useState<PlaylistSort>(() =>
    loadPlaylistSort(id, window.localStorage)
  )
  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    savePlaylistSort(id, next, window.localStorage)
  }
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  // Sıralı ya da süzülmüş görünüm Apple'ın liste sırası değil: çalma görünen sırayla.
  const sorted = !isDefaultSort(sort) || query !== ''
  const all = detail?.tracks
  const ordered = useMemo(() => sortTracks(all ?? [], sort), [all, sort])
  const tracks = useMemo(() => filterTracks(ordered, query), [ordered, query])
  const [added, setAdded] = useState(false)

  const loadPage = useCallback(
    (offset: number, limit: number) => Promise.resolve(tracks.slice(offset, offset + limit)),
    [tracks]
  )
  const playFrom = useCallback(
    (index: number) => {
      if (!player) return
      const plan = playlistStart(index, tracks.length, sorted)
      if (plan.kind === 'playlist') {
        const track = tracks[index]
        void player.playPlaylist(id, index, track ? trackTargets(track) : undefined).catch(() => {})
        return
      }
      // MusicKit liste kuyruğu ilk 100 şarkıyla sınırlı: basılan şarkının çevresindeki dilim.
      const ids = tracks.slice(plan.offset, plan.offset + plan.limit).map((t) => trackIds(t).play)
      void player.playSongs(ids, plan.start).catch(() => {})
    },
    [player, id, tracks, sorted]
  )
  const shuffle = (): void => {
    if (!player) return
    player.setShuffle(true)
    playFrom(0)
  }
  const addToLibrary = (): void => {
    setAdded(true)
    void app.library.addToLibrary({ playlists: [id] }).catch(() => setAdded(false))
  }

  return (
    <>
      <PageTint artwork={detail?.playlist.artworkUrl ?? artworkUrl} />
      <div className="collection-header">
        <Artwork
          url={detail?.playlist.artworkUrl ?? artworkUrl}
          size={480}
          kind="playlist"
          className="collection-header__art"
        />
        <motion.div
          className="collection-header__info"
          initial={{ opacity: 0, x: -12 }}
          animate={{
            opacity: 1,
            x: 0,
            transition: { delay: 0.12, type: 'spring', stiffness: 260, damping: 26 }
          }}
        >
          <h1 className="collection-header__title">{detail?.playlist.name ?? title}</h1>
          {detail?.curatorName && <p className="collection-header__kicker">{detail.curatorName}</p>}
          {detail?.playlist.description && <ExpandableNote text={detail.playlist.description} />}
          {detail && (
            <p className="collection-header__meta">
              {i18n.t('album.summary', {
                count: ordered.length,
                minutes: totalMinutes(ordered)
              })}
            </p>
          )}
          <div className="collection-header__actions">
            <button
              type="button"
              className="pill-button pill-button--primary"
              disabled={!player || tracks.length === 0}
              onClick={() => playFrom(0)}
            >
              <Play size={16} fill="currentColor" aria-hidden="true" />
              {i18n.t('collection.play')}
            </button>
            <button
              type="button"
              className="pill-button"
              disabled={!player || tracks.length === 0}
              onClick={shuffle}
            >
              <Shuffle size={16} aria-hidden="true" />
              {i18n.t('collection.shuffle')}
            </button>
            <button
              type="button"
              className="pill-button"
              disabled={!detail || added}
              onClick={addToLibrary}
            >
              {added ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Plus size={16} aria-hidden="true" />
              )}
              {i18n.t(added ? 'album.added' : 'album.addToLibrary')}
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
      {remote.state === 'loading' && <RowsSkeleton />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('page.loadFailed')} onRetry={reload} />
      )}
      {detail && (
        <>
          {query !== '' && tracks.length === 0 && (
            <p className="playlist-search__empty">{i18n.t('playlist.noMatches')}</p>
          )}
          <TrackTable
            total={tracks.length}
            resetKey={`${id}:${tracks.length}:${sort.by}:${sort.dir}:${query}`}
            loadPage={loadPage}
            onPlay={(_t, i) => playFrom(i)}
            menu={(t) => trackMenu(t)}
          />
          <div className="page-gap" />
          <Sections groups={detail.sections} />
        </>
      )}
    </>
  )
}
