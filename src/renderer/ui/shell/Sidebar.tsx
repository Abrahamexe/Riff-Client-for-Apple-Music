import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  ChevronDown,
  Clock3,
  Disc3,
  Guitar,
  Layers,
  House,
  LayoutGrid,
  ListMusic,
  MicVocal,
  Music,
  PenLine,
  Plus,
  Radio,
  Settings,
  type LucideIcon
} from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import { i18n } from '@core/i18n'
import { Artwork } from '../components/Artwork'
import { useApp } from '../context'
import { usePlaylists } from '../hooks/usePlaylists'
import { useOverlays } from '../overlays/Overlays'
import { playlistCard, useCardMenu } from '../overlays/itemMenus'
import { AccountRow } from './AccountRow'
import type { Rect } from './layout'
import { sidebarPanelMotion, SPRING_SOFT } from './motion'
import { sameRoute, useRouter, type Route } from './router'
import { useGo } from './scroll'
import { loadCollapsed, saveCollapsed, type SidebarSection } from './sidebarSections'

// Sol menü (B2). 2026-11-23 (geliştirici: "50 kere değiştirdik, beğenemedim; sağ paneller gibi
// olsun"): sağ panelin aynası — tam boy cam panel, oynatıcının sol ucundaki tuşla açılır ve o köşeden
// (sol alt) ölçeklenerek büyür; açıkken ana ekranı iter (Shell.tsx). Damla, X ikonu ve kilit kalktı;
// açık / kapalı durumu hatırlanır. İçerik Apple Music (Windows) kenar çubuğuyla aynı.
// Bölümler (2026-10-14, geliştirici kararı): "Arşiv" ve "Çalma Listeleri" başlığının yanındaki oka
// basınca bölüm açılır / kapanır; durum hatırlanır.

const TOP: { route: Route; key: MessageKey; icon: LucideIcon }[] = [
  { route: { name: 'home' }, key: 'nav.home', icon: House },
  { route: { name: 'browse' }, key: 'nav.new', icon: LayoutGrid },
  { route: { name: 'radio' }, key: 'nav.radio', icon: Radio }
]
const LIBRARY: { route: Route; key: MessageKey; icon: LucideIcon }[] = [
  { route: { name: 'recentlyAdded' }, key: 'nav.recentlyAdded', icon: Clock3 },
  { route: { name: 'artists' }, key: 'nav.artists', icon: MicVocal },
  { route: { name: 'albums' }, key: 'library.albums', icon: Disc3 },
  { route: { name: 'songs' }, key: 'nav.songs', icon: Music },
  // §3.6 (geliştirici kararı: Arşiv bölümüne; derleme yoksa Derlemeler gizli).
  { route: { name: 'genres' }, key: 'nav.genres', icon: Guitar },
  { route: { name: 'composers' }, key: 'nav.composers', icon: PenLine }
]

/** Arşivde derleme albüm var mı (yoksa "Derlemeler" gösterilmez); albüm senkronu değişince yenilenir. */
function useHasCompilations(): boolean {
  const app = useApp()
  const [has, setHas] = useState(false)
  useEffect(() => {
    const check = (): void =>
      void app.library
        .getLibraryCompilations({ limit: 1 })
        .then((p) => setHas(p.total > 0))
        .catch(() => {})
    check()
    const offChanged = app.library.onChanged((s) => {
      if (s.scope === 'albums') check()
    })
    const offSession = app.on('session', check)
    return () => {
      offChanged()
      offSession()
    }
  }, [app])
  return has
}

function NavItem({
  route,
  label,
  Icon,
  art,
  onContextMenu
}: {
  route: Route
  label: string
  Icon: LucideIcon
  /** Verilirse simgenin yerine küçük kapak (çalma listeleri; `null` = kapaksız liste, yer tutucu). */
  art?: { url: string | null }
  onContextMenu?: (e: MouseEvent) => void
}) {
  const { route: current } = useRouter()
  const go = useGo()
  const active = sameRoute(current, route)
  return (
    <button
      type="button"
      className={`nav-item${active ? ' nav-item--active' : ''}${art ? ' nav-item--art' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => go(route)}
      onContextMenu={onContextMenu}
    >
      {art ? (
        <Artwork url={art.url} size={96} kind="playlist" className="nav-item__art" />
      ) : (
        <Icon className="nav-item__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="nav-item__label">{label}</span>
    </button>
  )
}

/** Açılıp kapanan bölüm: başlık + ok düğmesi; gövde yüksekliği yayla 0 ↔ içerik. */
function Section({
  title,
  open,
  onToggle,
  action,
  children
}: {
  title: string
  open: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <div className="sidebar__section sidebar__section--action">
        <button
          type="button"
          className="sidebar__section-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span>{title}</span>
          <ChevronDown
            className={`sidebar__chevron${open ? '' : ' sidebar__chevron--closed'}`}
            size={13}
            strokeWidth={2.4}
            aria-hidden="true"
          />
        </button>
        {action}
      </div>
      <motion.div
        className="sidebar__group"
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={SPRING_SOFT}
        inert={!open}
      >
        {children}
      </motion.div>
    </>
  )
}

export function Sidebar({ rect }: { rect: Rect }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const isOpen = (s: SidebarSection): boolean => !collapsed.has(s)
  const toggle = (s: SidebarSection) => (): void => {
    const next = new Set(collapsed)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    setCollapsed(next)
    saveCollapsed(next)
  }
  const playlists = usePlaylists()
  const hasCompilations = useHasCompilations()
  const { openMenu, newPlaylist } = useOverlays()
  const cardMenu = useCardMenu()
  return (
    <motion.nav
      className="glass sidebar"
      aria-label={i18n.t('nav.menu')}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      {...sidebarPanelMotion}
    >
      <div className="sidebar__content">
        <div className="sidebar__scroll">
          {TOP.map((i) => (
            <NavItem key={i.key} route={i.route} label={i18n.format(i.key)} Icon={i.icon} />
          ))}
          <Section
            title={i18n.t('nav.library')}
            open={isOpen('library')}
            onToggle={toggle('library')}
          >
            {LIBRARY.map((i) => (
              <NavItem key={i.key} route={i.route} label={i18n.format(i.key)} Icon={i.icon} />
            ))}
            {hasCompilations && (
              <NavItem
                route={{ name: 'compilations' }}
                label={i18n.t('nav.compilations')}
                Icon={Layers}
              />
            )}
          </Section>
          <Section
            title={i18n.t('nav.playlists')}
            open={isOpen('playlists')}
            onToggle={toggle('playlists')}
            action={
              <button
                type="button"
                className="sidebar__add"
                aria-label={i18n.t('menu.newPlaylistTitle')}
                title={i18n.t('menu.newPlaylistTitle')}
                onClick={() => newPlaylist()}
              >
                <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            }
          >
            <NavItem
              route={{ name: 'playlists' }}
              label={i18n.t('nav.allPlaylists')}
              Icon={ListMusic}
            />
            {playlists.map((p) => (
              <NavItem
                key={p.id}
                route={{
                  name: 'playlist',
                  id: p.id,
                  title: p.name,
                  artworkUrl: p.artworkUrl,
                  description: p.description
                }}
                label={p.name}
                Icon={ListMusic}
                art={{ url: p.artworkUrl }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu(cardMenu(playlistCard(p)), { x: e.clientX, y: e.clientY })
                }}
              />
            ))}
          </Section>
        </div>
        <div className="sidebar__footer">
          <NavItem route={{ name: 'settings' }} label={i18n.t('nav.settings')} Icon={Settings} />
          <AccountRow />
        </div>
      </div>
    </motion.nav>
  )
}
