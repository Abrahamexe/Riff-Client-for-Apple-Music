import type { Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { Artwork } from './Artwork'
import { useMenuTrigger, useTrackMenu } from '../overlays/itemMenus'
import { MoreButton } from '../overlays/MoreButton'

// Yana kayan şarkı sütunlarının hücresi (B5 sanatçı "Popüler Parçalar"; B6 "Yeni" listesi): küçük
// kapak, ad (+ E), alt satır. Listelerde solda sıra numarası (Apple Music listeleri gibi).

export function SongCell({
  title,
  sub,
  artworkUrl,
  explicit,
  rank,
  active,
  onPlay,
  track
}: {
  title: string
  sub: string
  artworkUrl: string | null
  explicit?: boolean
  /** Liste sırası (1'den); verilmezse numara sütunu yok. */
  rank?: number
  active: boolean
  onPlay: () => void
  /** Verilirse "…" / sağ tık şarkı menüsü. */
  track?: Track
}) {
  const trackMenu = useTrackMenu()
  const { onContextMenu } = useMenuTrigger(() => (track ? trackMenu(track) : []))
  return (
    <div className="song-cell-wrap" onContextMenu={track ? onContextMenu : undefined}>
      <button
        type="button"
        className={`song-cell${rank === undefined ? '' : ' song-cell--ranked'}${active ? ' song-cell--active' : ''}`}
        onClick={onPlay}
      >
        {rank !== undefined && <span className="song-cell__rank">{rank}</span>}
        <Artwork url={artworkUrl} size={96} kind="song" />
        <span className="album-row__main">
          <span className="song-cell__title">
            {title}
            {explicit && (
              <span className="explicit" title={i18n.t('track.explicit')}>
                E
              </span>
            )}
          </span>
          <span className="song-cell__sub">{sub}</span>
        </span>
      </button>
      {track && <MoreButton className="song-cell__more" build={() => trackMenu(track)} />}
    </div>
  )
}
