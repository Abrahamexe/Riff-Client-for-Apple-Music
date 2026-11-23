import { useCallback, useState } from 'react'
import type { CardGroup, Genre } from '@shared/ipc-contract'
import type { Locale } from '@shared/i18n'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { Picker } from '../components/Picker'
import { LoadFailed, Sections } from '../components/Sections'
import { Shelf } from '../components/Shelf'
import { SongCell } from '../components/SongCell'
import { isCardPlaying, songId, splitCharts } from './charts'
import { cardTrack } from '../overlays/itemMenus'
import { ShelvesSkeleton } from './HomePage'

// "Yeni" (B6; geliştirici kararı: "Apple Music gibi"): Apple'ın listeleri. Üstte Popüler Listeler
// büyük kartlarla; Popüler Parçalar dört satırlı numaralı sütunlarda (çalınca liste sırayla çalar);
// sonra Popüler Albümler, Günlük Top 100, Şehir Listeleri. Başlıklar Apple'dan arayüz dilinde.
// ⚠ Sağ üstte tür seçici (Apple Music listelerindeki "Tüm Türler" gibi): türe göre yalnızca parça ve
// albüm listeleri gelir (Apple). Resmi API'de "Yeni" sayfasının editoryal rafları yok.

/** Her listeden en fazla bu kadar öğe (Popüler Parçalar: dört satırda ~10 sütun). */
const CHART_LIMIT = 40
const ALL_GENRES = ''

export function BrowsePage() {
  const app = useApp()
  const [genre, setGenre] = useState(ALL_GENRES)
  const loadGenres = useCallback((locale: Locale) => app.library.getGenres(locale), [app])
  const { remote: genres } = useRemote(loadGenres, 'genres')
  const loadCharts = useCallback(
    (locale: Locale) =>
      app.library.getCharts({
        limit: CHART_LIMIT,
        locale,
        ...(genre === ALL_GENRES ? {} : { genre })
      }),
    [app, genre]
  )
  const { remote, reload } = useRemote(loadCharts, `charts:${genre}`)

  return (
    <>
      <div className="page-header">
        <h1 className="page__title">{i18n.t('nav.new')}</h1>
        {genres.state === 'ready' && genres.value.length > 0 && (
          <Picker
            label={i18n.t('browse.genre')}
            value={genre}
            options={genreOptions(genres.value)}
            onChange={setGenre}
          />
        )}
      </div>
      {remote.state === 'loading' && <ShelvesSkeleton />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('browse.loadFailed')} onRetry={reload} />
      )}
      {remote.state === 'ready' && remote.value.length === 0 && (
        <p className="page-message">{i18n.t('browse.empty')}</p>
      )}
      {remote.state === 'ready' && <Charts groups={remote.value} />}
    </>
  )
}

const genreOptions = (genres: readonly Genre[]) => [
  { id: ALL_GENRES, label: i18n.t('browse.allGenres') },
  ...genres.map((g) => ({ id: g.id, label: g.name }))
]

/** Sayfa sırası: listeler (büyük) → parçalar → albümler → günlük → şehir. */
function Charts({ groups }: { groups: readonly CardGroup[] }) {
  const { lead, songs, rest } = splitCharts(groups)
  return (
    <>
      <Sections groups={lead} firstSize="large" />
      {songs.map((g) => (
        <ChartSongs key={g.id} group={g} />
      ))}
      <Sections groups={rest} />
    </>
  )
}

/** Popüler Parçalar: numaralı dört satırlı sütunlar; basılan şarkıdan itibaren liste çalar. */
function ChartSongs({ group }: { group: CardGroup }) {
  const { player, snapshot } = usePlayer()
  const current = displayedTrack(snapshot)
  const ids = group.cards.map(songId)
  const play = (index: number): void => {
    void player?.playSongs(ids, index).catch(() => {})
  }
  return (
    <Shelf title={group.title} size="chart">
      {group.cards.map((c, i) => (
        <SongCell
          key={c.id}
          rank={i + 1}
          title={c.name}
          sub={c.subtitle}
          artworkUrl={c.artworkUrl}
          {...(c.explicit ? { explicit: true } : {})}
          active={isCardPlaying(c, current)}
          track={cardTrack(c)}
          onPlay={() => play(i)}
        />
      ))}
    </Shelf>
  )
}
