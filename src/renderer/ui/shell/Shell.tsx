import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocale } from '../hooks/useLocale'
import { MainScrollbar } from './MainScrollbar'
import { AnimatePresence, motion } from 'motion/react'
import { createWarmup } from '@core/musickit/warmup'
import {
  anchoredZoomTransform,
  closestBox,
  takeZoomOrigin,
  zoomTransform,
  type Box
} from './zoomOrigin'
import { useApp, useSettings } from '../context'
import { HomePage } from '../pages/HomePage'
import { AlbumPage } from '../pages/AlbumPage'
import { ArtistPage } from '../pages/ArtistPage'
import { BrowsePage } from '../pages/BrowsePage'
import { CatalogPlaylistPage } from '../pages/CatalogPlaylistPage'
import { RadioPage } from '../pages/RadioPage'
import { SearchPage } from '../pages/SearchPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import {
  AlbumsPage,
  ArtistsPage,
  PlaylistsPage,
  RecentlyAddedPage
} from '../pages/library/GridPages'
import { PlaylistPage } from '../pages/library/PlaylistPage'
import { SongsPage } from '../pages/library/SongsPage'
import { CompilationsPage, FilteredSongsPage, NamedListPage } from '../pages/library/BrowseByPages'
import { TitleBar } from '../window/TitleBar'
import { computeLayout } from './layout'
import { RightPanel } from './RightPanel'
import { pageTransition, SPRING_SOFT } from './motion'
import { PlayerDock } from './PlayerDock'
import { routeKey, RouterProvider, useRouter, type Route } from './router'
import { MainScrollProvider } from './scroll'
import { NavControls } from './NavControls'
import { OverlayProvider } from '../overlays/Overlays'
import { MenuProvider } from '../overlays/itemMenus'
import { SearchBar } from './SearchBar'
import { Notices } from './Notices'
import { NowPlaying } from '../nowplaying/NowPlaying'
import { focusInfo, isPlaybackActive, shortcutAction } from './shortcuts'
import { stepVolume } from '../theme/tweaks'
import { FpsMeter } from './FpsMeter'
import { Sidebar } from './Sidebar'

// Uygulama kabuğu (PLAN_v5 B2): yüzen cam sütunlar. Açılışta sol menü ve oynatıcı açık gelir;
// sözler paneli kapalı (durumu ayarlarda hatırlanır). Dar pencerede paneller kendiliğinden kapanır.

function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'browse':
      return <BrowsePage />
    case 'radio':
      return <RadioPage />
    case 'search':
      return <SearchPage term={route.term} />
    case 'settings':
      return <SettingsPage />
    case 'songs':
      return <SongsPage />
    case 'genres':
    case 'composers':
      return <NamedListPage kind={route.name} />
    case 'genre':
      return <FilteredSongsPage filter={{ genre: route.genre }} />
    case 'composer':
      return <FilteredSongsPage filter={{ composer: route.composer }} />
    case 'compilations':
      return <CompilationsPage />
    case 'albums':
      return <AlbumsPage />
    case 'artists':
      return <ArtistsPage />
    case 'recentlyAdded':
      return <RecentlyAddedPage />
    case 'playlists':
      return <PlaylistsPage />
    case 'playlist':
      // Katalog playlist'i (`pl.…`, ör. "Sana Özel Listeler"): Apple'dan (B5).
      if (!route.id.startsWith('p.')) {
        return (
          <CatalogPlaylistPage id={route.id} title={route.title} artworkUrl={route.artworkUrl} />
        )
      }
      return (
        <PlaylistPage
          id={route.id}
          title={route.title}
          artworkUrl={route.artworkUrl}
          {...(route.description ? { description: route.description } : {})}
        />
      )
    case 'album':
      return <AlbumPage id={route.id} title={route.title} artworkUrl={route.artworkUrl} />
    case 'artist':
      return <ArtistPage id={route.id} title={route.title} />
  }
}

/**
 * Çalma bağlantısını ısıtma (`core/musickit/warmup.ts`, `main/playbackWarmup.ts`): açılışta, pencere
 * öne gelince ve pencerede herhangi bir etkinlikte (fare, tuş, tekerlek; en fazla 20 sn'de bir) Apple'ın
 * çalma sunucularına ön bağlantı. Ölçüm: yalnızca şarkı üzerine gelince ısıtmak yetmiyordu (yavaş DNS
 * 2–6 sn; üzerine gelme → tıklama ~1,5 sn). Zamanlayıcı yok: kullanıcı etkinken bağlantı sıcak kalır.
 */
function usePlaybackWarmup(enabled: boolean): void {
  useEffect(() => {
    // İnce ayar: kapatılabilir (ön bağlantı yok; ilk çalma yavaş DNS'te gecikebilir).
    if (!enabled) return
    const warm = createWarmup()
    warm()
    const onActivity = (): void => void warm()
    const events = ['pointermove', 'keydown', 'wheel', 'focus'] as const
    for (const name of events) window.addEventListener(name, onActivity, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, onActivity)
    }
  }, [enabled])
}

/** Karttan büyüyen sayfa açılan sayfalar. */
const ZOOM_ROUTES: ReadonlySet<Route['name']> = new Set(['album', 'playlist', 'artist'])

interface ZoomCustom {
  /** Giren sayfanın başlangıç dönüşümü (karttan büyüme); yoksa olağan geçiş. */
  enterFrom: { x: number; y: number; scale: number } | null
  /** Çıkan sayfanın küçüleceği yer (geri dönüşte açıldığı kart); yoksa olağan geçiş. */
  leaveTo: { x: number; y: number; scale: number } | null
  /** Büyüyen / küçülen sayfanın zemini (tema `--bg`): saydam sayfa eski sayfanın üstünde hayalet gibi
   *  duruyordu; geçiş boyunca opak kart, sonra saydam. */
  bg: string
  /** Geri dönüşte başlık kapağının karta uçuşu (albüm / playlist); varsa sayfa küçülmez, hızla söner. */
  flight: ZoomFlightSpec | null
}

interface ZoomFlightSpec {
  id: number
  src: string
  from: Box
  to: Box
}

const ZOOM_RADIUS = 40
/**
 * Geliştirici geri bildirimi (2026-10-14): "birden fırlıyor". Ölçüm: sert yayla genişlik 90 ms'de
 * 312 → 693 px; sayfa kurulumu (~40–70 ms'lik kare) sırasında animasyon saati ilerliyordu. Yavaş
 * başlayıp sakin biten eğri + kurulum bitene kadar 60 ms gecikme.
 */
const ZOOM_EASE: [number, number, number, number] = [0.45, 0, 0.15, 1]
const ZOOM_OPEN = { type: 'tween', duration: 0.55, delay: 0.06, ease: ZOOM_EASE } as const
const ZOOM_CLOSE = { type: 'tween', duration: 0.42, ease: ZOOM_EASE } as const
const CLEAR = 'rgba(0, 0, 0, 0)'
const themeBg = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b0b0e'

/**
 * Karttan büyüyen sayfa (geliştirici kararı 2026-10-14, `zoomOrigin.ts`): ileri gidişte basılan kartın
 * kutusu alınır, sayfa oradan büyür; kutu sayfa anahtarıyla saklanır, geri dönüşte aynı karta küçülür.
 * Hareket azaltmada Motion dönüşümleri atlar (yalnızca opaklık).
 */
function useZoomPages(
  key: string,
  route: Route,
  direction: 'forward' | 'back',
  mainEl: HTMLElement | null,
  paddingTop: number
) {
  const origins = useRef(
    new Map<string, { from: NonNullable<ZoomCustom['enterFrom']>; card: Box }>()
  )
  const flights = useRef(0)
  const last = useRef<{ key: string; custom: ZoomCustom }>({
    key,
    custom: { enterFrom: null, leaveTo: null, bg: CLEAR, flight: null }
  })
  if (last.current.key !== key) {
    const leavingKey = last.current.key
    let custom: ZoomCustom = { enterFrom: null, leaveTo: null, bg: CLEAR, flight: null }
    const origin = takeZoomOrigin()
    if (direction === 'forward' && origin && ZOOM_ROUTES.has(route.name) && mainEl) {
      const page = mainEl.querySelector('.page-stack > .page')?.getBoundingClientRect()
      const main = mainEl.getBoundingClientRect()
      if (page) {
        const pageBox = {
          x: page.left,
          y: main.top + paddingTop,
          width: page.width,
          height: main.height
        }
        // Albüm / playlist: başlık kapağı karta oturur. Sanatçı: başlık geniş görsel, sayfa karttan büyür.
        const from =
          route.name === 'artist'
            ? zoomTransform(origin, pageBox)
            : anchoredZoomTransform(origin, pageBox)
        origins.current.set(key, { from, card: origin })
        custom = { enterFrom: from, leaveTo: null, bg: themeBg(), flight: null }
      }
    } else if (direction === 'back') {
      const saved = origins.current.get(leavingKey)
      origins.current.delete(leavingKey)
      // Geliştirici geri bildirimi (2026-10-15): sayfa küçülürken şarkı listesi ortada donmuş gibi
      // görünüyordu. Albüm / playlist'te başlık kapağı (şu anki yerinden) karta uçar, sayfa hızla söner.
      const pages = mainEl?.querySelectorAll('.page-stack > .page')
      const leaving = pages?.[pages.length - 1]
      const art = leaving?.querySelector('.collection-header__art')
      const img = art?.querySelector('img')
      const r = art?.getBoundingClientRect()
      const canFly = saved && img?.currentSrc && r && r.width > 0
      if (canFly) leaving?.setAttribute('data-zoom-leaving', '')
      const flight = canFly
        ? {
            id: ++flights.current,
            src: img.currentSrc,
            from: { x: r.left, y: r.top, width: r.width, height: r.height },
            to: saved.card
          }
        : null
      custom = {
        enterFrom: null,
        leaveTo: flight ? null : (saved?.from ?? null),
        bg: themeBg(),
        flight
      }
    }
    last.current = { key, custom }
  }
  return { custom: last.current.custom, variants: ZOOM_VARIANTS }
}

const ZOOM_VARIANTS = {
  enter: (c: ZoomCustom) =>
    c.enterFrom
      ? {
          ...c.enterFrom,
          opacity: 0,
          transformOrigin: '0 0',
          backgroundColor: c.bg,
          borderRadius: ZOOM_RADIUS
        }
      : { ...pageTransition.initial, x: 0, scale: 1 },
  shown: (c: ZoomCustom) =>
    c.enterFrom
      ? {
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          borderRadius: 0,
          transitionEnd: { backgroundColor: CLEAR },
          transition: { ...ZOOM_OPEN, opacity: { duration: 0.2, ease: 'linear' } }
        }
      : { ...pageTransition.animate, x: 0, scale: 1 },
  leave: (c: ZoomCustom) =>
    c.leaveTo
      ? {
          ...c.leaveTo,
          opacity: 0,
          transformOrigin: '0 0',
          backgroundColor: c.bg,
          borderRadius: ZOOM_RADIUS,
          // Giren (geri dönülen) sayfa DOM'da sonra gelir: küçülen sayfa onun üstünde kalmalı.
          zIndex: 2,
          transition: {
            ...ZOOM_CLOSE,
            backgroundColor: { duration: 0 },
            // Küçülürken opak kalır; yalnızca karta yaklaşınca söner (yoksa sayfalar karışıyordu).
            opacity: { duration: 0.14, delay: 0.28 }
          }
        }
      : c.flight
        ? ({ opacity: 0, transition: { duration: 0.16, ease: 'easeOut' } } as const)
        : pageTransition.exit
}

/**
 * Geri dönüşte başlık kapağının kopyası karttaki yerine uçar (`ZoomCustom.flight`). Dönülen sayfadaki
 * kart kapağı uçuş bitene kadar gizlenir (iki kapak görünmesin). Hareket azaltmada Motion dönüşümü
 * atlar, kopya hemen kalkar.
 */
function ZoomFlight({ spec, mainEl }: { spec: ZoomFlightSpec; mainEl: HTMLElement | null }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (done) return
    // Dönülen sayfanın kartları veri gelince çizilebilir (geliştirici 2026-10-15: "eski yeri boş
    // olsun"): kart bulunana kadar birkaç kare aranır; çıkan sayfa (`data-zoom-leaving`) atlanır.
    let card: HTMLElement | null = null
    let frame = 0
    let tries = 0
    const find = (): void => {
      const pages = mainEl?.querySelectorAll<HTMLElement>(
        '.page-stack > .page:not([data-zoom-leaving])'
      )
      const arts = pages
        ? [...pages].flatMap((p) => [...p.querySelectorAll<HTMLElement>('.artwork')])
        : []
      card = closestBox(
        spec.to,
        arts.map((item) => {
          const r = item.getBoundingClientRect()
          return { item, box: { x: r.left, y: r.top, width: r.width, height: r.height } }
        })
      )
      if (card) card.style.visibility = 'hidden'
      else if (++tries < 30) frame = requestAnimationFrame(find)
    }
    find()
    return () => {
      cancelAnimationFrame(frame)
      if (card) card.style.visibility = ''
    }
  }, [spec, mainEl, done])
  if (done) return null
  const { from, to } = spec
  return (
    <motion.div
      className="zoom-flight"
      aria-hidden="true"
      style={{
        left: from.x,
        top: from.y,
        width: from.width,
        height: from.height,
        transformOrigin: '0 0'
      }}
      initial={{ x: 0, y: 0, scale: 1 }}
      animate={{ x: to.x - from.x, y: to.y - from.y, scale: to.width / from.width }}
      transition={ZOOM_CLOSE}
      onAnimationComplete={() => setDone(true)}
    >
      <img src={spec.src} alt="" draggable={false} />
    </motion.div>
  )
}

/** Klavye kısayolları (§3.3, `shortcuts.ts`): yalnızca çalma; başka bir bileşen tuşu işlediyse yok sayılır. */
function useKeyboardShortcuts(): void {
  const app = useApp()
  // İnce ayar: ses adımı (%); dinleyici yeniden kurulmasın diye ref.
  const volumeStep = useRef(5)
  volumeStep.current = useSettings()?.tweaks.volumeStep ?? 5
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || !app.hasPlayer) return
      const action = shortcutAction(e, focusInfo(document.activeElement))
      if (!action) return
      e.preventDefault()
      const player = app.player
      const ignore = (): void => {}
      switch (action) {
        case 'playPause':
          void (isPlaybackActive(player.snapshot().state) ? player.pause() : player.play()).catch(
            ignore
          )
          break
        case 'next':
          void player.next().catch(ignore)
          break
        case 'previous':
          void player.previous().catch(ignore)
          break
        case 'volumeUp':
        case 'volumeDown': {
          const up = action === 'volumeUp'
          player.setVolume(stepVolume(player.snapshot().volume, volumeStep.current, up))
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app])
}

function ShellBody() {
  useKeyboardShortcuts()
  const app = useApp()
  const settings = useSettings()
  const viewport = useViewport()
  usePlaybackWarmup(settings?.tweaks.playbackWarmup ?? true)
  const { route, restoreScroll, direction } = useRouter()
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  // Geliştirici isteği (2026-10-15): uygulama menü kapalı açılır.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [playerExpanded, setPlayerExpanded] = useState(true)
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const rightPanel = settings?.appearance.rightPanel ?? 'none'

  const layout = computeLayout(viewport, {
    sidebarOpen,
    rightOpen: rightPanel !== 'none',
    playerExpanded
  })
  const { effective } = layout
  const setRightPanel = (panel: typeof rightPanel): void => {
    void app.settings.update({ appearance: { rightPanel: panel } }).catch(() => {})
  }
  // Pencere daralınca panel kendiliğinden kapanır; düğmeye basılırsa yeniden açılmaya çalışılmaz.
  const shownPanel = effective.rightOpen ? rightPanel : 'none'
  // Arama çubuğu, açık menü ve sağ panel dışındaki görünür alanın ortasında.
  const visibleLeft = effective.sidebarOpen ? layout.sidebar.x + layout.sidebar.width : 0
  const visibleWidth = viewport.width - visibleLeft - layout.main.right
  const searchLeft = visibleLeft + visibleWidth / 2 - 210

  // Yeni sayfa en üstten; geri dönülen sayfa bırakıldığı yerden (B4).
  const key = routeKey(route)
  const zoom = useZoomPages(key, route, direction, mainEl, layout.mainPadding.top)
  useLayoutEffect(() => {
    if (mainEl) mainEl.scrollTop = restoreScroll
  }, [key, mainEl, restoreScroll])

  return (
    <MainScrollProvider element={mainEl}>
      <motion.main
        ref={setMainEl}
        className="main"
        initial={false}
        animate={{ left: layout.main.left, right: layout.main.right }}
        transition={SPRING_SOFT}
        style={
          {
            paddingLeft: layout.mainPadding.left,
            paddingTop: layout.mainPadding.top,
            paddingBottom: layout.mainPadding.bottom,
            // Sayfa tonu (PageTint) alt boşluğa (oynatıcının altı) kadar uzansın.
            '--main-pad-bottom': `${layout.mainPadding.bottom}px`
          } as CSSProperties
        }
      >
        {/* Kapaktan büyüme: sayfanın kendisi karttan büyür (useZoomPages); kapak ayrıca uçmaz. */}
        {/* Sayfalar aynı ızgara hücresinde üst üste: çıkan sayfa yeni sayfayı aşağı itmez (B4). */}
        <div className="page-stack">
          <AnimatePresence initial={false} custom={zoom.custom}>
            <motion.div
              key={key}
              className="page"
              custom={zoom.custom}
              variants={zoom.variants}
              initial="enter"
              animate="shown"
              exit="leave"
            >
              <Page route={route} />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.main>
      <MainScrollbar
        element={mainEl}
        paddingTop={layout.mainPadding.top}
        paddingBottom={layout.mainPadding.bottom}
      />
      {zoom.custom.flight ? (
        <ZoomFlight key={zoom.custom.flight.id} spec={zoom.custom.flight} mainEl={mainEl} />
      ) : null}
      <TitleBar />
      <NavControls sidebar={layout.sidebar} sidebarOpen={effective.sidebarOpen} />
      <SearchBar centerX={searchLeft} />
      {settings?.tweaks.fpsMeter ? <FpsMeter /> : null}
      <Notices centerX={searchLeft + 210} />
      <Sidebar
        rect={layout.sidebar}
        maxHeight={layout.sidebarMaxHeight}
        open={effective.sidebarOpen}
        onToggle={() => setSidebarOpen(!effective.sidebarOpen)}
      />
      <AnimatePresence>
        {layout.right && shownPanel !== 'none' && (
          <RightPanel key="right" rect={layout.right} mode={shownPanel} />
        )}
      </AnimatePresence>
      <PlayerDock
        rect={layout.player}
        contentWidth={layout.playerContentWidth}
        expanded={effective.playerExpanded}
        rightPanel={shownPanel}
        onExpandedChange={setPlayerExpanded}
        onRightPanel={setRightPanel}
        nowPlayingOpen={nowPlayingOpen}
        onOpenNowPlaying={() => setNowPlayingOpen(true)}
      />
      <AnimatePresence>
        {nowPlayingOpen && <NowPlaying key="np" onClose={() => setNowPlayingOpen(false)} />}
      </AnimatePresence>
    </MainScrollProvider>
  )
}

export function Shell() {
  // Dil değişince arayüz metinleri yeniden kurulur; sayfa (router) ve oynatma korunur.
  const locale = useLocale()
  return (
    <RouterProvider>
      <OverlayProvider>
        <MenuProvider>
          <ShellBody key={locale} />
        </MenuProvider>
      </OverlayProvider>
    </RouterProvider>
  )
}
