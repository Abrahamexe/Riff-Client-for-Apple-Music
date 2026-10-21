import { useCallback, useState } from 'react'
import { motion } from 'motion/react'
import { Play } from 'lucide-react'
import type { ArtistDetail, Card } from '@shared/ipc-contract'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { useGo } from '../shell/scroll'
import { cardRoute } from '../components/cardRoute'
import { MediaCard } from '../components/MediaCard'
import { ExpandableNote, LoadFailed, Sections, playAction } from '../components/Sections'
import { Shelf } from '../components/Shelf'
import { SongCell } from '../components/SongCell'
import { isCurrent } from '../components/TrackTable'
import { releaseYear } from '../format'
import { ShelvesSkeleton } from './HomePage'
import { PageTint } from '../components/PageTint'

// Sanatçı sayfası (B5; geliştirici kararı: "Geniş kapak görseli"): üstte sanatçının geniş görseli,
// üzerinde adı ve çal düğmesi (popüler parçaları çalar). Altında Son Çıkan + Popüler Parçalar
// (yana kayan üç satırlık sütunlar), sonra Apple'ın rafları (Albümler, Single'lar ve EP'ler, Canlı
// Albümler, Derlemeler, Yer Aldıkları, Sanatçı Listeleri, Benzer Sanatçılar) ve Hakkında.
// Hareketli sanatçı görseli resmi API'de yok; görsel alanı bunun için ayrıldı (B5 notu).

const HERO_SIZE = 1600

export function ArtistPage({ id, title }: { id: string; title: string }) {
  const app = useApp()
  const { player } = usePlayer()
  const load = useCallback(
    (locale: Parameters<typeof app.library.getArtist>[1]) => app.library.getArtist(id, locale),
    [app, id]
  )
  const { remote, reload } = useRemote(load, `artist:${id}`)
  const detail = remote.state === 'ready' ? remote.value : null
  const songIds = (detail?.topSongs ?? []).map((t) => t.playParams?.id ?? t.id)
  const playTop = (index: number): void => {
    void player?.playSongs(songIds, index).catch(() => {})
  }

  return (
    <>
      <PageTint artwork={detail?.artist.artworkUrl} size={HERO_SIZE} />
      <ArtistHero
        name={detail?.artist.name ?? title}
        artworkUrl={detail?.artist.artworkUrl ?? null}
        canPlay={!!player && songIds.length > 0}
        onPlay={() => playTop(0)}
      />
      {remote.state === 'loading' && <ShelvesSkeleton largeFirst={false} />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('page.loadFailed')} onRetry={reload} />
      )}
      {detail && (
        <>
          <ArtistTop detail={detail} onPlaySong={playTop} />
          <Sections groups={detail.sections} titleFallback={i18n.t('artist.libraryAlbums')} />
          {(detail.editorialNote || detail.genres.length > 0) && (
            <section className="artist-about">
              <h2 className="shelf__title">{i18n.t('artist.about')}</h2>
              {detail.editorialNote && <ExpandableNote text={detail.editorialNote} />}
              {detail.genres.length > 0 && (
                <p className="artist-about__genre">{detail.genres.join(', ')}</p>
              )}
            </section>
          )}
        </>
      )}
    </>
  )
}

function ArtistHero({
  name,
  artworkUrl,
  canPlay,
  onPlay
}: {
  name: string
  artworkUrl: string | null
  canPlay: boolean
  onPlay: () => void
}) {
  const src = cachedArtworkUrl(artworkUrl, HERO_SIZE)
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <motion.div
      className="artist-hero"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
    >
      {src && src !== failed && (
        <motion.img
          key={src}
          className="artist-hero__media"
          src={src}
          alt=""
          draggable={false}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45 }}
          onError={() => setFailed(src)}
        />
      )}
      <div className="artist-hero__bar">
        <motion.button
          type="button"
          className="artist-hero__play"
          aria-label={i18n.t('collection.play')}
          disabled={!canPlay}
          onClick={onPlay}
          whileHover={canPlay ? { scale: 1.08 } : {}}
          whileTap={canPlay ? { scale: 0.92 } : {}}
        >
          <Play size={22} fill="currentColor" strokeWidth={0} />
        </motion.button>
        <h1 className="artist-hero__name">{name}</h1>
      </div>
    </motion.div>
  )
}

/** Son Çıkan (tek kart) + Popüler Parçalar (yana kayan üç satır). */
function ArtistTop({
  detail,
  onPlaySong
}: {
  detail: ArtistDetail
  onPlaySong: (index: number) => void
}) {
  const go = useGo()
  const { player, snapshot } = usePlayer()
  const current = displayedTrack(snapshot)
  const latest = detail.latestRelease
  if (!latest && detail.topSongs.length === 0) return null
  const latestCard: Card | null = latest
    ? {
        kind: 'album',
        id: latest.id,
        name: latest.name,
        subtitle: releaseYear(latest.releaseDate) ?? latest.artistName,
        artworkUrl: latest.artworkUrl,
        playParams: latest.playParams,
        ...(latest.explicit ? { explicit: true } : {})
      }
    : null
  const latestPlay = latestCard ? playAction(player, latestCard) : undefined
  return (
    <div className={`artist-top${latestCard ? '' : ' artist-top--songs-only'}`}>
      {latestCard && (
        <section>
          <h2 className="shelf__title">
            {detail.latestReleaseTitle ?? i18n.t('artist.latestRelease')}
          </h2>
          <MediaCard
            card={latestCard}
            onOpen={() => {
              const route = cardRoute(latestCard)
              if (route) go(route)
            }}
            {...(latestPlay ? { onPlay: latestPlay } : {})}
          />
        </section>
      )}
      {detail.topSongs.length > 0 && (
        <Shelf title={detail.topSongsTitle ?? i18n.t('artist.topSongs')} size="songs">
          {detail.topSongs.map((t, i) => (
            <SongCell
              key={t.id}
              title={t.name}
              sub={t.albumName}
              artworkUrl={t.artworkUrl}
              {...(t.explicit ? { explicit: true } : {})}
              active={isCurrent(t, current)}
              onPlay={() => onPlaySong(i)}
              track={t}
            />
          ))}
        </Shelf>
      )}
    </div>
  )
}
