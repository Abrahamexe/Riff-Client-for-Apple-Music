import type { ReactNode } from 'react'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import type { SatelliteItem } from './satelliteItems'

// Gözlemevi büyük oynatıcısı (2026-11-27): kapak ortada, iki yanında sıradaki iki şarkı uydu olarak
// (küçük kapak + ad). Basınca o şarkıya geçilir. Halka / yörünge çizgisi yok (geliştirici kararı).

export interface SatelliteTrack {
  title: string
  artist?: string | undefined
  artworkTemplate?: string | null | undefined
}

export function Satellites({
  items,
  onPlay,
  children
}: {
  items: SatelliteItem<SatelliteTrack>[]
  onPlay: (index: number) => void
  children: ReactNode
}) {
  const [next, later] = items
  return (
    <div className="obs-sats">
      {next ? <Satellite sat={next} side="left" onPlay={onPlay} label="queue.upNext" /> : null}
      {children}
      {later ? <Satellite sat={later} side="right" onPlay={onPlay} /> : null}
    </div>
  )
}

function Satellite({
  sat,
  side,
  label,
  onPlay
}: {
  sat: SatelliteItem<SatelliteTrack>
  side: 'left' | 'right'
  label?: 'queue.upNext'
  onPlay: (index: number) => void
}) {
  const art = cachedArtworkUrl(sat.item.artworkTemplate, 160)
  const name = sat.item.artist ? `${sat.item.title} — ${sat.item.artist}` : sat.item.title
  return (
    <button
      type="button"
      className={`obs-sat obs-sat--${side}`}
      title={name}
      aria-label={name}
      onClick={() => onPlay(sat.index)}
    >
      {art ? (
        <img className="obs-sat__art" src={art} alt="" draggable={false} />
      ) : (
        <span className="obs-sat__art" />
      )}
      <span className="obs-sat__text">
        {label ? <span className="obs-sat__kicker">{i18n.t(label)}</span> : null}
        <span className="obs-sat__title">{sat.item.title}</span>
        {sat.item.artist ? <span className="obs-sat__artist">{sat.item.artist}</span> : null}
      </span>
    </button>
  )
}
