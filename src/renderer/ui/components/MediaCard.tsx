import { Play } from 'lucide-react'
import type { Card } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { Artwork } from './Artwork'
import { useCardMenu, useMenuTrigger } from '../overlays/itemMenus'
import { MoreButton } from '../overlays/MoreButton'
import { setZoomOrigin } from '../shell/zoomOrigin'

// Raf kartı (B4 ek; Apple Music Ana Sayfa): kapak + ad + alt satır. `wide` (B6 Radyo): 16:9 görselli
// büyük istasyon kartı. Canlı istasyonda görselin sol üstünde "CANLI" rozeti; istasyonun alt satırı
// Apple'ın tanıtım satırı (ör. "En iyi yeni müzik."). Üzerine gelince kapağın sol
// altında cam çal düğmesi belirir (Apple Music gibi); karta basınca sayfası açılır, sayfası olmayan
// (istasyon, şarkı) çalar. Sayfa karttan büyür ("kapaktan büyüme", zoomOrigin.ts).
// Üzerine gelme / basma yaylanması CSS'te (B5 akıcılık: kart başına Motion bileşeni, sayfa açılırken
// yüzlerce kartın kurulmasını yavaşlatıyordu).

export function MediaCard({
  card,
  onOpen,
  onPlay,
  wide
}: {
  card: Card
  wide?: boolean
  onOpen: () => void
  onPlay?: () => void
}) {
  const placeholder = card.kind === 'station' ? 'album' : card.kind
  const cardMenu = useCardMenu()
  const { onContextMenu } = useMenuTrigger(() => cardMenu(card))
  return (
    <div
      className={`media-card${wide ? ' media-card--wide' : ''}`}
      data-kind={card.kind}
      onContextMenu={onContextMenu}
      onPointerDown={(e) => {
        const art = e.currentTarget.querySelector('.media-card__art')
        if (art) setZoomOrigin(art)
      }}
    >
      <button type="button" className="media-card__open" onClick={onOpen}>
        <span className="media-card__art">
          <Artwork
            url={card.artworkUrl}
            size={wide ? 840 : card.kind === 'station' ? 400 : 340}
            kind={placeholder}
            round={card.kind === 'artist'}
            {...(wide ? { wide } : {})}
          />
          {card.isLive && <span className="live-badge">{i18n.t('radio.live')}</span>}
        </span>
        <span className="media-card__title">
          {card.name}
          {card.explicit && (
            <span className="explicit" title={i18n.t('track.explicit')}>
              E
            </span>
          )}
        </span>
        <span className="media-card__sub">{card.tagline ?? card.subtitle}</span>
      </button>
      {onPlay && (
        <button
          type="button"
          className="media-card__play glass"
          aria-label={i18n.t('collection.play')}
          onClick={onPlay}
        >
          <Play size={18} fill="currentColor" strokeWidth={0} />
        </button>
      )}
      <MoreButton className="card-more" build={() => cardMenu(card)} />
    </div>
  )
}
