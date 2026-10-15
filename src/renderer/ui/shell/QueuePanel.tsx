import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { Infinity as InfinityIcon, ListX, Menu as GripIcon } from 'lucide-react'
import type { NowPlaying, Player } from '@core/musickit/player'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import { useApp, useSettings } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import { MoreButton } from '../overlays/MoreButton'
import { nowPlayingTrack, useMenuTrigger, useTrackMenu } from '../overlays/itemMenus'
import { useOverlays, type MenuEntry } from '../overlays/Overlays'
import { dropTarget, queueEntries, type QueueEntry } from './queueRows'

// Sıradaki (B3): Apple Music gibi Geçmiş · Şu An Çalıyor · Sıradaki · Otomatik Çalma. Otomatik çalma
// bölümü P3'teki `autoplayIndex`'ten; ∞ düğmesi Apple'ın otomatik çalma ayarı. Satıra basınca o
// şarkıya geçilir. Çok uzun kuyrukta ilk 200 sıradaki gösterilir (sanal liste B4'te).
// Düzenleme (§3.2, geliştirici kararı 2026-10-14): Sıradaki şarkılar sağdaki ≡ tutamaçla sürüklenir
// (klavyede tutamaçta ↑/↓); "…" ve sağ tık menüsünde "Sıradakinden Çıkar" (satır küçülerek kaybolur);
// "Sıradaki" başlığının sağında "Temizle" (onaysız, kısa bildirim). Otomatik çalma öğeleri
// sıralanamaz, çıkarılabilir. Çalan şarkı ve geçmiş değişmez.

const MAX_ROWS = 200
const ROW_EXIT = { opacity: 0, height: 0, transition: { duration: 0.22, ease: 'easeOut' as const } }

function Row({
  item,
  dim,
  current,
  onPlay,
  menu,
  handle
}: {
  item: NowPlaying
  dim?: boolean
  current?: boolean
  onPlay?: () => void
  menu?: () => MenuEntry[]
  handle?: ReactNode
}) {
  const art = cachedArtworkUrl(item.artworkTemplate, 80)
  const { onContextMenu } = useMenuTrigger(menu ?? (() => []))
  return (
    <div
      className={`queue-row-wrap${menu || handle ? ' queue-row-wrap--tools' : ''}`}
      onContextMenu={menu ? onContextMenu : undefined}
    >
      <button
        type="button"
        className={`queue-row${dim ? ' queue-row--dim' : ''}${current ? ' queue-row--current' : ''}`}
        onClick={onPlay}
        disabled={!onPlay}
      >
        {art ? <img src={art} alt="" draggable={false} /> : <span className="queue-row__art" />}
        <span className="queue-row__text">
          <span className="queue-row__title">{item.title}</span>
          <span className="queue-row__sub">{item.artist}</span>
        </span>
      </button>
      {(menu || handle) && (
        <span className="queue-row__tools">
          {menu && <MoreButton className="queue-row__more" build={menu} />}
          {handle}
        </span>
      )}
    </div>
  )
}

/** Sürüklenebilir Sıradaki satırı: yalnızca ≡ tutamaçtan tutulur (satıra basmak çalar). */
function UpNextRow({
  entry,
  row,
  onDrop,
  onStep
}: {
  entry: QueueEntry
  row: (entry: QueueEntry, handle: ReactNode) => ReactNode
  onDrop: (key: string) => void
  onStep: (entry: QueueEntry, delta: -1 | 1) => void
}) {
  const controls = useDragControls()
  const [dragging, setDragging] = useState(false)
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    onStep(entry, e.key === 'ArrowUp' ? -1 : 1)
  }
  const handle = (
    <button
      type="button"
      className="queue-row__handle"
      aria-label={i18n.t('queue.reorder', { title: entry.item.title })}
      title={i18n.t('queue.reorderHint')}
      onPointerDown={(e) => controls.start(e)}
      onKeyDown={onKeyDown}
    >
      <GripIcon size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
  return (
    <Reorder.Item
      as="div"
      value={entry}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false)
        onDrop(entry.key)
      }}
      className={`queue-item${dragging ? ' queue-item--dragging' : ''}`}
      exit={ROW_EXIT}
    >
      {row(entry, handle)}
    </Reorder.Item>
  )
}

function UpNext({
  entries,
  player,
  row
}: {
  entries: QueueEntry[]
  player: Player | null
  row: (entry: QueueEntry, handle: ReactNode) => ReactNode
}) {
  const [order, setOrder] = useState(entries)
  const latest = useRef(order)
  latest.current = order
  useEffect(() => setOrder(entries), [entries])
  const move = (from: number, to: number): void => {
    try {
      player?.moveQueueItem(from, to)
    } catch {
      setOrder(entries) // geçersiz / başarısız: eski sıraya dön
    }
  }
  return (
    <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="queue__list">
      <AnimatePresence initial={false}>
        {order.map((entry) => (
          <UpNextRow
            key={entry.key}
            entry={entry}
            row={row}
            onDrop={(key) => {
              const target = dropTarget(latest.current, key)
              if (target) move(target.from, target.to)
            }}
            onStep={(e, delta) => {
              const to = e.index + delta
              if (entries.some((x) => x.index === to)) move(e.index, to)
            }}
          />
        ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

export function QueuePanel() {
  const app = useApp()
  const settings = useSettings()
  const trackMenu = useTrackMenu()
  const { toast } = useOverlays()
  const { player, snapshot } = usePlayer()
  const items = useMemo(() => snapshot?.queue.items ?? [], [snapshot])
  const position = snapshot?.queue.position ?? -1
  const autoplayIndex = snapshot?.queue.autoplayIndex ?? null
  const autoplayOn = settings?.playback.autoplay ?? true
  // Kuyruk kurulup henüz başlamadıysa (konum -1) ilk şarkı "şu an" sayılır (çubukla aynı).
  const currentIndex = Math.max(0, position)
  const current = items[currentIndex]
  const upcomingEnd =
    autoplayIndex === null ? items.length : Math.max(autoplayIndex, currentIndex + 1)
  const upNext = useMemo(
    () => queueEntries(items, currentIndex + 1, Math.min(upcomingEnd, currentIndex + 1 + MAX_ROWS)),
    [items, currentIndex, upcomingEnd]
  )
  const autoplay = useMemo(
    () =>
      autoplayIndex === null
        ? []
        : queueEntries(items, Math.max(autoplayIndex, currentIndex + 1), items.length).slice(
            0,
            MAX_ROWS
          ),
    [items, autoplayIndex, currentIndex]
  )

  const failed = (): void => toast(i18n.t('menu.toast.failed'))
  const play = (index: number) => (): void => {
    void player?.playQueueIndex(index).catch(() => {})
  }
  /** Menü kurulduktan sonra kuyruk değiştiyse yanlış şarkı çıkmasın: sıra hâlâ aynı şarkıda mı. */
  const remove = (entry: QueueEntry) => (): void => {
    try {
      if (player?.snapshot().queue.items[entry.index]?.id !== entry.item.id) throw new Error()
      player.removeQueueItem(entry.index)
    } catch {
      failed()
    }
  }
  const menu = (item: NowPlaying, entry?: QueueEntry) => (): MenuEntry[] => {
    const entries = trackMenu(nowPlayingTrack(item))
    if (!entry) return entries
    const removeEntry: MenuEntry = {
      kind: 'item',
      label: i18n.t('menu.removeFromQueue'),
      icon: ListX,
      onSelect: remove(entry)
    }
    // Sıradaki Çal · Sonra Çal'dan sonra (Apple Music'teki yerine yakın).
    return [...entries.slice(0, 2), removeEntry, { kind: 'separator' }, ...entries.slice(2)]
  }
  const clear = (): void => {
    try {
      player?.clearUpNext()
      toast(i18n.t('queue.cleared'))
    } catch {
      failed()
    }
  }
  const historyRows = queueEntries(items, Math.max(0, currentIndex - MAX_ROWS), currentIndex)

  return (
    <div className="queue">
      {historyRows.length > 0 && (
        <>
          <h3 className="queue__heading">{i18n.t('queue.history')}</h3>
          {historyRows.map((e) => (
            <Row key={e.key} item={e.item} dim onPlay={play(e.index)} menu={menu(e.item)} />
          ))}
        </>
      )}
      <h3 className="queue__heading">{i18n.t('queue.nowPlaying')}</h3>
      {current ? (
        <Row item={current} current menu={menu(current)} />
      ) : (
        <p className="queue__empty">{i18n.t('player.nothingPlaying')}</p>
      )}
      {upNext.length > 0 && (
        <>
          <div className="queue__heading-row">
            <h3 className="queue__heading">{i18n.t('queue.upNext')}</h3>
            <button type="button" className="queue__clear" onClick={clear}>
              {i18n.t('queue.clear')}
            </button>
          </div>
          <UpNext
            entries={upNext}
            player={player}
            row={(e, handle) => (
              <Row item={e.item} onPlay={play(e.index)} menu={menu(e.item, e)} handle={handle} />
            )}
          />
        </>
      )}
      <div className="queue__autoplay">
        <h3 className="queue__heading">{i18n.t('queue.autoplay')}</h3>
        <button
          type="button"
          className={`icon-button${autoplayOn ? ' icon-button--on' : ''}`}
          aria-label={i18n.t('queue.autoplay')}
          aria-pressed={autoplayOn}
          title={i18n.t('queue.autoplay')}
          onClick={() => {
            void app.settings.update({ playback: { autoplay: !autoplayOn } }).catch(() => {})
          }}
        >
          <InfinityIcon size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {autoplayOn && (
        <AnimatePresence initial={false}>
          {autoplay.map((e) => (
            <motion.div key={e.key} className="queue-item" layout="position" exit={ROW_EXIT}>
              <Row item={e.item} onPlay={play(e.index)} menu={menu(e.item, e)} />
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  )
}
