import { useCallback, useRef } from 'react'
import type { Card, Genre } from '@shared/ipc-contract'
import type { Locale } from '@shared/i18n'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { useSeen } from '../hooks/useSeen'
import { MediaCard } from '../components/MediaCard'
import { LoadFailed, Sections, playAction } from '../components/Sections'
import { Shelf } from '../components/Shelf'
import { ShelvesSkeleton } from './HomePage'

// Radyo (B6; geliştirici kararı: "Apple Music gibi"): üstte Apple Music canlı istasyonları büyük
// 16:9 kartlarla ("CANLI" rozeti + Apple'ın tanıtım satırı), altında Son Dinlenen İstasyonlar, sonra
// Apple'ın istasyon türleri (Pop, Rock, Caz …) birer raf. Tür rafları kaydırınca yüklenir.
// İstasyonun sayfası yok: karta basınca çalar.

interface RadioData {
  live: Card[]
  recent: Card[]
  genres: Genre[]
}

export function RadioPage() {
  const app = useApp()
  const load = useCallback(
    async (locale: Locale): Promise<RadioData> => {
      const [live, recent, genres] = await Promise.all([
        app.library.getLiveStations(locale),
        // Ek raflar: alınamazsa sayfa yine açılır.
        app.library.getRecentStations({ limit: 20, locale }).catch((): Card[] => []),
        app.library.getStationGenres(locale).catch((): Genre[] => [])
      ])
      return { live, recent, genres }
    },
    [app]
  )
  const { remote, reload } = useRemote(load, 'radio')

  return (
    <>
      <h1 className="page__title">{i18n.t('nav.radio')}</h1>
      {remote.state === 'loading' && <ShelvesSkeleton />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('radio.loadFailed')} onRetry={reload} />
      )}
      {remote.state === 'ready' && (
        <>
          <LiveStations stations={remote.value.live} />
          {remote.value.recent.length > 0 && (
            <Sections
              groups={[{ id: 'recent', title: i18n.t('radio.recent'), cards: remote.value.recent }]}
            />
          )}
          {remote.value.genres.map((g) => (
            <GenreStations key={g.id} genre={g} />
          ))}
        </>
      )}
    </>
  )
}

function LiveStations({ stations }: { stations: readonly Card[] }) {
  const { player } = usePlayer()
  if (stations.length === 0) return null
  return (
    <Shelf title="" size="wide">
      {stations.map((s) => {
        const play = playAction(player, s)
        return (
          <MediaCard
            key={s.id}
            card={s}
            wide
            onOpen={() => play?.()}
            {...(play ? { onPlay: play } : {})}
          />
        )
      })}
    </Shelf>
  )
}

/** Bir istasyon türünün rafı: görünür alana yaklaşınca istenir; boşsa ya da alınamazsa çizilmez. */
function GenreStations({ genre }: { genre: Genre }) {
  const app = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref)
  const load = useCallback(
    (locale: Locale): Promise<Card[]> =>
      seen ? app.library.getGenreStations(genre.id, locale) : new Promise<Card[]>(() => {}),
    [app, genre.id, seen]
  )
  const { remote } = useRemote(load, `radio-genre:${genre.id}:${seen}`)
  if (remote.state === 'failed' || (remote.state === 'ready' && remote.value.length === 0)) {
    return null
  }
  return (
    <div ref={ref} className="lazy-shelf">
      {remote.state === 'ready' ? (
        <Sections groups={[{ id: genre.id, title: genre.name, cards: remote.value }]} />
      ) : (
        <ShelvesSkeleton largeFirst={false} count={1} />
      )}
    </div>
  )
}
