import { useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { CardGroup } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { usePlayer } from '../hooks/usePlayer'
import { useGo } from '../shell/scroll'
import { cardRoute } from './cardRoute'
import { playAction } from './playAction'
import { MediaCard } from './MediaCard'
import { Shelf, type ShelfSize } from './Shelf'

export { playAction } from './playAction'

// Sayfa parçaları (B4 ek / B5): Apple'ın kart rafları, "DAHA FAZLA" ile açılan not, yükleme hatası.

/** Kart rafları. */
export function Sections({
  groups,
  firstSize = 'regular',
  titleFallback
}: {
  groups: readonly CardGroup[]
  firstSize?: ShelfSize
  /** Apple başlık vermezse (ör. kütüphane sanatçısı) gösterilecek başlık. */
  titleFallback?: string
}) {
  const go = useGo()
  const { player } = usePlayer()
  return (
    <>
      {groups.map((g, index) => (
        <Shelf
          key={g.id}
          title={g.title || titleFallback || ''}
          size={index === 0 ? firstSize : 'regular'}
        >
          {g.cards.map((c) => {
            const route = cardRoute(c)
            const play = playAction(player, c)
            return (
              <MediaCard
                key={`${c.kind}:${c.id}`}
                card={c}
                onOpen={() => {
                  if (route) go(route)
                  else play?.()
                }}
                {...(play && c.kind !== 'artist' ? { onPlay: play } : {})}
              />
            )
          })}
        </Shelf>
      ))}
    </>
  )
}

/** Apple notu: üç satır, "DAHA FAZLA" ile tamamı (düz metin; worker HTML'i ayıklar). */
export function ExpandableNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220 || text.includes('\n')
  return (
    <div className={`note${open ? ' note--open' : ''}`}>
      <p className="note__text">{text}</p>
      {long && (
        <button type="button" className="note__toggle" onClick={() => setOpen(!open)}>
          {i18n.t(open ? 'note.less' : 'note.more')}
        </button>
      )}
    </div>
  )
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="page-message">
      <p>{message}</p>
      <button type="button" className="pill-button" onClick={onRetry}>
        <RotateCw size={15} aria-hidden="true" />
        {i18n.t('home.retry')}
      </button>
    </div>
  )
}

/** Şarkı listesi yüklenirken soluk satırlar. */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rows-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton--row" />
      ))}
    </div>
  )
}
