import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import { AudioLines, Check, Play, Plus, Shuffle } from 'lucide-react'
import type { AlbumDetail, Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { displayedTrack, formatTime, usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { useGo } from '../shell/scroll'
import { Artwork } from '../components/Artwork'
import { PageTint } from '../components/PageTint'
import { ExpandableNote, LoadFailed, RowsSkeleton, Sections } from '../components/Sections'
import { isCurrent } from '../components/TrackTable'
import { audioBadges, discGroups, formatReleaseDate, releaseYear, totalMinutes } from '../format'
import { trackTargets, useCardMenu, useMenuTrigger, useTrackMenu } from '../overlays/itemMenus'
import { MoreButton } from '../overlays/MoreButton'

// Albüm sayfası (B5; geliştirici: "Apple Music gibi"): büyük kapak (karttan büyüyerek gelir), ad,
// sanatçı (basınca sanatçı sayfası), tür · yıl · ses rozetleri, Apple notu ("DAHA FAZLA"), Çal /
// Karıştır / Arşive Ekle. Şarkı listesi kapaksız (hepsi aynı albüm): numara, ad, süre; çok diskli
// albümde disk başlıkları. Altta yayın tarihi, şarkı sayısı + süre, telif; sonra Apple'ın rafları
// (Diğer Versiyonlar, İlgili Albümler, Şurada Yer Alıyor). Hareketli kapak resmi API'de yok (B5 notu).

export function AlbumPage({
  id,
  title,
  artworkUrl
}: {
  id: string
  title: string
  artworkUrl: string | null
}) {
  const cardMenu = useCardMenu()
  const app = useApp()
  const go = useGo()
  const { player, snapshot } = usePlayer()
  const load = useCallback(
    (locale: Parameters<typeof app.library.getAlbum>[1]) => app.library.getAlbum(id, locale),
    [app, id]
  )
  const { remote, reload } = useRemote(load, `album:${id}`)
  const detail = remote.state === 'ready' ? remote.value : null
  const album = detail?.album
  const [added, setAdded] = useState(false)

  const playFrom = useCallback(
    (index: number, track?: Track) => {
      void player?.playAlbum(id, index, track ? trackTargets(track) : undefined).catch(() => {})
    },
    [player, id]
  )
  const shuffle = (): void => {
    if (!player) return
    player.setShuffle(true)
    playFrom(0)
  }
  const addToLibrary = (): void => {
    setAdded(true)
    void app.library.addToLibrary({ albums: [id] }).catch(() => setAdded(false))
  }

  const year = releaseYear(album?.releaseDate)
  const genre = detail?.genres[0]
  const tracks = detail?.tracks ?? []
  const current = displayedTrack(snapshot)
  const playing = snapshot?.state === 'playing'
  const albumArtist = album?.artistName ?? ''

  return (
    <>
      <PageTint artwork={album?.artworkUrl ?? artworkUrl} />
      <div className="collection-header">
        <Artwork
          url={album?.artworkUrl ?? artworkUrl}
          size={480}
          kind="album"
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
          <h1 className="collection-header__title">
            {album?.name ?? title}
            {album?.explicit && (
              <span className="explicit" title={i18n.t('track.explicit')}>
                E
              </span>
            )}
          </h1>
          {albumArtist && (
            <p className="collection-header__kicker">
              <button
                type="button"
                className="link-button"
                disabled={!detail?.artistId}
                onClick={() => {
                  if (detail?.artistId)
                    go({ name: 'artist', id: detail.artistId, title: albumArtist })
                }}
              >
                {albumArtist}
              </button>
            </p>
          )}
          {detail && (
            <p className="collection-header__meta collection-header__meta--row">
              {[genre, year].filter(Boolean).join(' · ')}
              {audioBadges(detail.audioVariants).map((b) => (
                <span key={b} className="audio-badge">
                  {i18n.t(`audio.${b}`)}
                </span>
              ))}
            </p>
          )}
          {detail?.editorialNote && <ExpandableNote text={detail.editorialNote} />}
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
            {/* Kütüphane albümü (`l.…`) zaten arşivde. */}
            {!id.startsWith('l.') && (
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
            )}
            <MoreButton
              className="header-more"
              build={() =>
                cardMenu({
                  kind: 'album',
                  id,
                  name: detail?.album.name ?? title,
                  subtitle: detail?.album.artistName ?? '',
                  artworkUrl: detail?.album.artworkUrl ?? artworkUrl,
                  playParams: null
                })
              }
            />
          </div>
        </motion.div>
      </div>

      {remote.state === 'loading' && <RowsSkeleton />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('page.loadFailed')} onRetry={reload} />
      )}

      {detail && (
        <>
          <div className="album-tracks">
            {discGroups(tracks).map((group, _i, all) => (
              <div key={group.disc}>
                {all.length > 1 && (
                  <h2 className="album-tracks__disc">{i18n.t('album.disc', { n: group.disc })}</h2>
                )}
                {group.tracks.map(({ track, index }) => (
                  <AlbumRow
                    key={track.id}
                    track={track}
                    albumArtist={albumArtist}
                    active={isCurrent(track, current)}
                    playing={playing}
                    onPlay={() => playFrom(index, track)}
                  />
                ))}
              </div>
            ))}
          </div>
          <AlbumFooter detail={detail} />
          <Sections groups={detail.sections} />
        </>
      )}
    </>
  )
}

function AlbumRow({
  track,
  albumArtist,
  active,
  playing,
  onPlay
}: {
  track: Track
  albumArtist: string
  active: boolean
  playing: boolean
  onPlay: () => void
}) {
  const trackMenu = useTrackMenu()
  const { onContextMenu } = useMenuTrigger(() => trackMenu(track))
  return (
    <div className="album-row-wrap" onContextMenu={onContextMenu}>
      <button
        type="button"
        className={`album-row${active ? ' album-row--active' : ''}`}
        onClick={onPlay}
      >
        <span className="album-row__index">
          {active && playing ? (
            <AudioLines size={15} strokeWidth={2} aria-hidden="true" />
          ) : (
            <>
              <span className="album-row__number">{track.trackNumber ?? ''}</span>
              <Play className="album-row__play" size={14} fill="currentColor" aria-hidden="true" />
            </>
          )}
        </span>
        <span className="album-row__main">
          <span className="album-row__title">
            {track.name}
            {track.explicit && (
              <span className="explicit" title={i18n.t('track.explicit')}>
                E
              </span>
            )}
          </span>
          {/* Konuk sanatçı / derleme: albüm sanatçısından farklıysa (Apple Music gibi). */}
          {track.artistName && track.artistName !== albumArtist && (
            <span className="album-row__artist">{track.artistName}</span>
          )}
        </span>
        <span className="album-row__time">
          {track.durationMs !== null ? formatTime(track.durationMs / 1000) : ''}
        </span>
      </button>
      <MoreButton className="album-row__more" build={() => trackMenu(track)} />
    </div>
  )
}

function AlbumFooter({ detail }: { detail: AlbumDetail }) {
  const date = formatReleaseDate(detail.album.releaseDate, i18n.locale)
  return (
    <div className="album-footer">
      {date && <p>{date}</p>}
      <p>
        {i18n.t('album.summary', {
          count: detail.tracks.length,
          minutes: totalMinutes(detail.tracks)
        })}
      </p>
      {detail.copyright && <p>{detail.copyright}</p>}
      {detail.recordLabel && !detail.copyright?.includes(detail.recordLabel) && (
        <p>{detail.recordLabel}</p>
      )}
    </div>
  )
}
