import { Ellipsis } from 'lucide-react'
import { i18n } from '@core/i18n'
import type { MenuEntry } from './Overlays'
import { useMenuTrigger } from './itemMenus'

/** "…" düğmesi: menüyü düğmenin altında açar (satır / kart üzerine gelince görünür). */
export function MoreButton({ build, className }: { build: () => MenuEntry[]; className?: string }) {
  const { onMore } = useMenuTrigger(build)
  return (
    <button
      type="button"
      className={`more-button${className ? ` ${className}` : ''}`}
      aria-label={i18n.t('menu.more')}
      title={i18n.t('menu.more')}
      aria-haspopup="menu"
      onClick={onMore}
    >
      <Ellipsis size={18} strokeWidth={2.2} aria-hidden="true" />
    </button>
  )
}
