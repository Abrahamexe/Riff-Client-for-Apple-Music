import {
  createContext,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  Clock3,
  Disc3,
  Guitar,
  Layers,
  Lock,
  LockOpen,
  House,
  LayoutGrid,
  ListMusic,
  Menu,
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
import { contentIn, menuContentIn, menuTransition, SPRING_SOFT } from './motion'
import { sameRoute, useRouter, type Route } from './router'
import { useGo } from './scroll'
import {
  loadCollapsed,
  loadPinned,
  saveCollapsed,
  savePinned,
  type SidebarSection
} from './sidebarSections'

// Sol menü (B2): kapalıyken sol üstte üç çizgili damla; açılınca yukarıdan aşağı uzayıp yuvarlak
// köşeli cam panele dönüşür. İçerik Apple Music (Windows) kenar çubuğuyla aynı.
// Bölümler (2026-10-14, geliştirici kararı): "Arşiv" ve "Çalma Listeleri" başlığının yanındaki oka
// basınca bölüm açılır / kapanır; durum hatırlanır. Panelin yüksekliği içeriğe göre (`height: auto`,
// en fazla ekran): bölüm kapanınca panel de aynı yayla, aynı karede küçülür (ölçüm / gecikme yok).
// Kilit (2026-10-15): hamburgerin yanında; kilit açıkken menüden bir sayfaya gidilince menü kapanır,
// kilitliyken hep açık kalır. Uygulama menü kapalı açılır.

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
  const goRoute = useGo()
  const navigated = useContext(NavigatedContext)
  const go = (r: Route): void => {
    goRoute(r)
    navigated()
  }
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

/** Menüden bir yere gidildi (kilit açıksa menü kapanır). */
const NavigatedContext = createContext<() => void>(() => {})

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

export function Sidebar({
  rect,
  maxHeight,
  open,
  onToggle
}: {
  rect: Rect
  /** Açık panelin çıkabileceği en büyük yükseklik; gerçek yükseklik içeriğe göre. */
  maxHeight: number
  open: boolean
  onToggle: () => void
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [pinned, setPinned] = useState(loadPinned)
  const togglePinned = (): void => {
    setPinned(!pinned)
    savePinned(!pinned)
  }
  const navigated = (): void => {
    if (!pinned && open) onToggle()
  }
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
      className={`glass sidebar${open ? '' : ' sidebar--droplet'}`}
      aria-label={i18n.t('nav.menu')}
      initial={false}
      animate={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: open ? 'auto' : rect.height
      }}
      style={{ maxHeight }}
      transition={menuTransition(open)}
    >
      <button
        type="button"
        className="sidebar__toggle"
        aria-label={i18n.t(open ? 'nav.closeMenu' : 'nav.openMenu')}
        aria-expanded={open}
        title={i18n.t(open ? 'nav.closeMenu' : 'nav.openMenu')}
        onClick={onToggle}
      >
        <Menu size={20} strokeWidth={1.9} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.button
            key="pin"
            type="button"
            className={`sidebar__pin${pinned ? ' sidebar__pin--on' : ''}`}
            aria-label={i18n.t(pinned ? 'nav.unpinMenu' : 'nav.pinMenu')}
            aria-pressed={pinned}
            title={i18n.t(pinned ? 'nav.unpinMenu' : 'nav.pinMenu')}
            onClick={togglePinned}
            {...contentIn}
          >
            {pinned ? (
              <Lock size={15} strokeWidth={2} aria-hidden="true" />
            ) : (
              <LockOpen size={15} strokeWidth={2} aria-hidden="true" />
            )}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <NavigatedContext.Provider value={navigated} key="content">
            <motion.div className="sidebar__content" {...menuContentIn}>
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
                <NavItem
                  route={{ name: 'settings' }}
                  label={i18n.t('nav.settings')}
                  Icon={Settings}
                />
                <AccountRow />
              </div>
            </motion.div>
          </NavigatedContext.Provider>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
