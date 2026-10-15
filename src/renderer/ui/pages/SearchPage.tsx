import { useCallback, useState } from 'react'
import type { SearchGroups, Track } from '@shared/ipc-contract'
import type { Locale, MessageKey } from '@shared/i18n'
import { fromWireError } from '@core/errors'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { useRemote } from '../hooks/useRemote'
import { LoadFailed, RowsSkeleton, Sections } from '../components/Sections'
import { Shelf } from '../components/Shelf'
import { SongCell } from '../components/SongCell'
import { isCurrent, playableId } from '../components/TrackTable'
import { isEmptyResult, resultShelves, type ResultShelf } from './searchCards'
import { ShelvesSkeleton } from './HomePage'

// Arama sonuçları (B7; geliştirici kararı: Apple Music gibi): üstte "Apple Music | Arşivin" seçici;
// En İyi Sonuçlar, Şarkılar (dört satırlı sütunlar), Sanatçılar (yuvarlak), Albümler, Çalma
// Listeleri, İstasyonlar. Arşivde En İyi Sonuçlar ve istasyon yok (Apple).
// ⚠ Sayfa başlığı aranan terim (benim seçimim).

type Scope = 'catalog' | 'library'

/** Her türden en fazla bu kadar sonuç (Apple sınırı 25). */
const RESULT_LIMIT = 25

const SHELF_TITLES: Record<ResultShelf, MessageKey> = {
  top: 'search.top',
  artists: 'nav.artists',
  albums: 'library.albums',
  playlists: 'nav.playlists',
  stations: 'search.stations'
}

export function SearchPage({ term }: { term: string }) {
  const app = useApp()
  const [scope, setScope] = useState<Scope>('catalog')
  const load = useCallback(
    async (locale: Locale): Promise<SearchGroups | null> => {
      const res = await app.search.find(term, { scope, limit: RESULT_LIMIT, locale })
      const error = res[`${scope}Error`]
      // Kaynak hata verdiyse (ör. ağ): katalog kodlu hata → "Tekrar dene".
      if (!res[scope] && error) throw fromWireError(error)
      return res[scope]
    },
    [app, term, scope]
  )
  const { remote, reload } = useRemote(load, `search:${scope}:${term}`)
  const groups = remote.state === 'ready' ? remote.value : null

  return (
    <>
      <div className="page-header">
        <h1 className="page__title search-page__title">{term}</h1>
        <ScopePicker value={scope} onChange={setScope} />
      </div>
      {remote.state === 'loading' && (
        <>
          <ShelvesSkeleton count={1} />
          <RowsSkeleton rows={4} />
        </>
      )}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('search.loadFailed')} onRetry={reload} />
      )}
      {remote.state === 'ready' && (!groups || isEmptyResult(groups)) && (
        <p className="page-message">{i18n.t('search.noResults', { term })}</p>
      )}
      {groups && !isEmptyResult(groups) && (
        <Results groups={groups} library={scope === 'library'} />
      )}
    </>
  )
}

function ScopePicker({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const options: { id: Scope; key: MessageKey }[] = [
    { id: 'catalog', key: 'search.scopeCatalog' },
    { id: 'library', key: 'search.scopeLibrary' }
  ]
  return (
    <div
      className="segmented glass glass--capsule"
      role="radiogroup"
      aria-label={i18n.t('search.scope')}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          className={`segmented__item${o.id === value ? ' segmented__item--on' : ''}`}
          onClick={() => onChange(o.id)}
        >
          {i18n.format(o.key)}
        </button>
      ))}
    </div>
  )
}

function Results({ groups, library }: { groups: SearchGroups; library: boolean }) {
  const shelves = resultShelves(groups)
  const top = shelves.filter((s) => s.id === 'top')
  const rest = shelves.filter((s) => s.id !== 'top')
  const toGroups = (list: typeof shelves) =>
    list.map((s) => ({ id: s.id, title: i18n.format(SHELF_TITLES[s.id]), cards: s.cards }))
  return (
    <>
      <Sections groups={toGroups(top)} />
      {groups.songs.length > 0 && <SongResults tracks={groups.songs} library={library} />}
      <Sections groups={toGroups(rest)} />
    </>
  )
}

/** Şarkılar: dört satırlı sütunlar; katalogda basılan şarkıdan itibaren sonuçlar sırayla çalar. */
function SongResults({ tracks, library }: { tracks: readonly Track[]; library: boolean }) {
  const { player, snapshot } = usePlayer()
  const current = displayedTrack(snapshot)
  const play = (index: number): void => {
    const run = library
      ? player?.playSong(playableId(tracks[index]!))
      : player?.playSongs(tracks.map(playableId), index)
    void run?.catch(() => {})
  }
  return (
    <Shelf title={i18n.t('nav.songs')} size="chart">
      {tracks.map((t, i) => (
        <SongCell
          key={t.id}
          title={t.name}
          sub={t.artistName}
          artworkUrl={t.artworkUrl}
          {...(t.explicit ? { explicit: true } : {})}
          active={isCurrent(t, current)}
          onPlay={() => play(i)}
          track={t}
        />
      ))}
    </Shelf>
  )
}
