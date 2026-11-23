import type { Card } from '@shared/ipc-contract'
import { useCardMenu, useMenuTrigger } from '../overlays/itemMenus'
import { MoreButton } from '../overlays/MoreButton'
import { Artwork } from './Artwork'
import { setZoomOrigin } from '../shell/zoomOrigin'

// Kapak ızgarası (B4): albümler, son eklenenler, çalma listeleri. Karta basınca sayfa açılır ve
// karttan büyür ("kapaktan büyüme": basılan kapağın yeri zoomOrigin.ts'e kaydedilir).

export interface GridItem {
  key: string
  title: string
  subtitle: string
  artworkUrl: string | null
  kind: 'album' | 'playlist' | 'song' | 'artist'
  explicit?: boolean
  onOpen: () => void
  /** "…" / sağ tık menüsü için kart. */
  card?: Card
}

export function CardGrid({ items }: { items: GridItem[] }) {
  return (
    <div className="card-grid">
      {items.map((it) => (
        <GridCard key={it.key} item={it} />
      ))}
    </div>
  )
}

function GridCard({ item: it }: { item: GridItem }) {
  const cardMenu = useCardMenu()
  const card = it.card
  const { onContextMenu } = useMenuTrigger(() => (card ? cardMenu(card) : []))
  return (
    <div className="grid-card-wrap" onContextMenu={card ? onContextMenu : undefined}>
      <button
        type="button"
        className="grid-card"
        onClick={it.onOpen}
        onPointerDown={(e) => {
          const art = e.currentTarget.querySelector('.artwork')
          if (art) setZoomOrigin(art)
        }}
      >
        <Artwork url={it.artworkUrl} size={340} kind={it.kind} round={it.kind === 'artist'} />
        <span className="grid-card__title">
          {it.title}
          {it.explicit && <span className="explicit">E</span>}
        </span>
        <span className="grid-card__sub">{it.subtitle}</span>
      </button>
      {card && <MoreButton className="card-more" build={() => cardMenu(card)} />}
    </div>
  )
}
