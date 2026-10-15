import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Play, Shuffle } from 'lucide-react'
import type { PlaylistSort } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'
import { usePlayer } from '../../hooks/usePlayer'
import { Artwork } from '../../components/Artwork'
import { TrackTable } from '../../components/TrackTable'
import { playlistStart } from '../../components/playlistWindow'
import { useScopeVersion } from './common'
import { useCardMenu, useTrackMenu } from '../../overlays/itemMenus'
import { MoreButton } from '../../overlays/MoreButton'
import { isDefaultSort, loadPlaylistSort, savePlaylistSort } from './playlistSort'
import { PlaylistSortButton } from './PlaylistSortButton'

// Çalma listesi sayfası (B4): Apple Music gibi büyük kapak, ad, açıklama, Çal / Karıştır ve şarkı
// tablosu (sanal; binlerce şarkı). Kapak, açıldığı karttan büyüyerek gelir (kapaktan büyüme).
// "Sırala" menüsü: playlist sırası / ad / sanatçı / albüm / süre, artan ya da azalan; her playlist
// kendi seçimini hatırlar (playlistSort.ts). Sıralı görünümde çalma, görünen sırayla kuyruğa alınır.

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
  const version = useScopeVersion('playlists')
  const [sort, setSortState] = useState<PlaylistSort>(() =>
    loadPlaylistSort(id, window.localStorage)
  )
  const sorted = !isDefaultSort(sort)
  const setSort = (next: PlaylistSort): void => {
    setSortState(next)
    savePlaylistSort(id, next, window.localStorage)
  }

  useEffect(() => {
    void app.library
      .getPlaylistTracks(id, { offset: 0, limit: 1 })
      .then((p) => setTotal(p.total))
      .catch(() => {})
    const off = app.library.onChanged((s) => {
      if (s.scope === 'playlistTracks' && s.playlistId === id) {
        void app.library
          .getPlaylistTracks(id, { offset: 0, limit: 1 })
          .then((p) => setTotal(p.total))
          .catch(() => {})
      }
    })
    return off
  }, [app, id, version])

  const loadPage = useCallback(
    (offset: number, limit: number) =>
      app.library.getPlaylistTracks(id, { offset, limit, sort }).then((p) => p.items),
    [app, id, sort]
  )
  const playFrom = useCallback(
    (index: number) => {
      if (!player) return
      const plan = playlistStart(index, total, sorted)
      if (plan.kind === 'playlist') {
        void player.playPlaylist(id, index).catch(() => {})
        return
      }
      // MusicKit liste kuyruğu ilk 100 şarkıyla sınırlı (ve Apple sırasıyla): basılan şarkıdan dilim.
      void app.library
        .getPlaylistTracks(id, { offset: plan.offset, limit: plan.limit, sort })
        .then((p) =>
          player.playSongs(
            p.items.map((t) => t.id),
            plan.start
          )
        )
        .catch(() => {})
    },
    [app, player, id, total, sorted, sort]
  )
  const shuffle = (): void => {
    if (!player) return
    player.setShuffle(true)
    playFrom(0)
  }

  return (
    <>
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
          </div>
        </motion.div>
      </div>
      <TrackTable
        total={total}
        resetKey={`${id}:${version}:${sort.by}:${sort.dir}`}
        loadPage={loadPage}
        onPlay={(_t, i) => playFrom(i)}
        menu={(t) => trackMenu(t, { id })}
      />
    </>
  )
}
