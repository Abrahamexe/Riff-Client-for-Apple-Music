import { useCallback } from 'react'
import { AudioLines, Play } from 'lucide-react'
import type { Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { usePlayer, formatTime, displayedTrack } from '../hooks/usePlayer'
import { Artwork } from './Artwork'
import { VirtualRows } from './VirtualRows'
import { MoreButton } from '../overlays/MoreButton'
import { useOverlays, type MenuEntry } from '../overlays/Overlays'

// Şarkı tablosu (B4): Apple Music gibi Başlık · Sanatçı · Albüm · Süre. Sanal satırlar (binlerce şarkı);
// satıra basınca çalar, çalan satır vurgulanır, üzerine gelince sıra numarası yerine ▶ görünür.
// 2026-10-19: boşluklu pill satırlar; sanatçı adın altında (ayrı sütun yok): Başlık · Albüm · Süre.

const TRACK_ROW_HEIGHT = 64

export function isCurrent(t: Track, current: { id: string; catalogId?: string } | null): boolean {
  if (!current) return false
  return (
    t.id === current.id ||
    (t.playParams?.catalogId !== undefined && t.playParams.catalogId === current.catalogId)
  )
}

export function TrackTable({
  total,
  resetKey,
  loadPage,
  onPlay,
  showArtwork = true,
  menu
}: {
  total: number
  resetKey: string
  loadPage: (offset: number, limit: number) => Promise<Track[]>
  onPlay: (track: Track, index: number) => void
  showArtwork?: boolean
  /** Satırın "…" / sağ tık menüsü. */
  menu?: (track: Track) => MenuEntry[]
}) {
  const { openMenu } = useOverlays()
  const { snapshot } = usePlayer()
  const current = displayedTrack(snapshot)
  const playing = snapshot?.state === 'playing'
  const renderRow = useCallback(
    (t: Track | undefined, i: number) => {
      if (!t) return <div className="track-row track-row--loading" aria-hidden="true" />
      const active = isCurrent(t, current)
      return (
        <div
          className="track-row-wrap"
          onContextMenu={
            menu
              ? (e) => {
                  e.preventDefault()
                  openMenu(menu(t), { x: e.clientX, y: e.clientY })
                }
              : undefined
          }
        >
          <button
            type="button"
            className={`track-row${active ? ' track-row--active' : ''}`}
            onClick={() => onPlay(t, i)}
          >
            <span className="track-row__index">
              {active && playing ? (
                <AudioLines size={15} strokeWidth={2} aria-hidden="true" />
              ) : (
                <>
                  <span className="track-row__number">{i + 1}</span>
                  <Play
                    className="track-row__play"
                    size={14}
                    fill="currentColor"
                    aria-hidden="true"
                  />
                </>
              )}
            </span>
            <span className="track-row__title">
              {showArtwork && (
                <Artwork url={t.artworkUrl} size={80} kind="song" className="track-row__art" />
              )}
              <span className="track-row__main">
                <span className="track-row__line">
                  <span className="track-row__name">{t.name}</span>
                  {t.explicit && (
                    <span className="explicit" title={i18n.t('track.explicit')}>
                      E
                    </span>
                  )}
                </span>
                <span className="track-row__artist">{t.artistName}</span>
              </span>
            </span>
            <span className="track-row__cell">{t.albumName}</span>
            <span className="track-row__time">
              {t.durationMs === null ? '' : formatTime(t.durationMs / 1000)}
            </span>
          </button>
          {menu && <MoreButton className="track-row__more" build={() => menu(t)} />}
        </div>
      )
    },
    [current, playing, onPlay, showArtwork, menu, openMenu]
  )

  return (
    <div className="track-table" role="table" aria-rowcount={total}>
      <div className="track-table__head" role="row">
        <span />
        <span>{i18n.t('track.title')}</span>
        <span>{i18n.t('track.album')}</span>
        <span className="track-row__time">{i18n.t('track.time')}</span>
      </div>
      <VirtualRows
        total={total}
        rowHeight={TRACK_ROW_HEIGHT}
        resetKey={resetKey}
        loadPage={loadPage}
        renderRow={renderRow}
      />
    </div>
  )
}

/** Kütüphane / katalog şarkısının MusicKit'e verilecek kimliği. */
export function playableId(t: Track): string {
  return t.playParams?.catalogId ?? t.playParams?.id ?? t.id
}
