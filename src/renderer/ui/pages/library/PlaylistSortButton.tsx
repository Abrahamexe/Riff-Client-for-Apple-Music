import { ArrowDownUp, Check } from 'lucide-react'
import type { PlaylistSort } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useMenuTrigger } from '../../overlays/itemMenus'
import type { MenuEntry } from '../../overlays/Overlays'
import { directionKey, isDefaultSort, SORT_FIELD_KEYS } from './playlistSort'

// Playlist "Sırala" düğmesi (kütüphane ve Apple playlist sayfaları).

const FIELDS = Object.keys(SORT_FIELD_KEYS) as PlaylistSort['by'][]

/** "Sırala" düğmesi: alan ve yön menüsü; seçili olanlar ✓ ile. */
export function PlaylistSortButton({
  value,
  onChange
}: {
  value: PlaylistSort
  onChange: (sort: PlaylistSort) => void
}) {
  const { onMore } = useMenuTrigger((): MenuEntry[] => [
    ...FIELDS.map((by): MenuEntry => ({
      kind: 'item',
      label: i18n.t(SORT_FIELD_KEYS[by]),
      ...(by === value.by ? { icon: Check } : {}),
      // Yeni alan artan yönle başlar; aynı alan yeniden seçilirse yön korunur.
      onSelect: () => onChange({ by, dir: by === value.by ? value.dir : 'asc' })
    })),
    { kind: 'separator' },
    ...(['asc', 'desc'] as const).map((dir): MenuEntry => ({
      kind: 'item',
      label: i18n.t(directionKey(value.by, dir)),
      ...(dir === value.dir ? { icon: Check } : {}),
      onSelect: () => onChange({ by: value.by, dir })
    }))
  ])
  const label = isDefaultSort(value)
    ? i18n.t('sort.label')
    : `${i18n.t(SORT_FIELD_KEYS[value.by])} · ${i18n.t(directionKey(value.by, value.dir))}`
  return (
    <button
      type="button"
      className={`pill-button${isDefaultSort(value) ? '' : ' pill-button--on'}`}
      aria-haspopup="menu"
      onClick={onMore}
    >
      <ArrowDownUp size={16} aria-hidden="true" />
      {label}
    </button>
  )
}
