import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// Sayfa yönlendirmesi (B2 → B4): bağımlılık yok, bellek içi geçmiş. Geri dönünce kaydırma konumu
// geri gelir (Apple Music gibi). Albüm / sanatçı sayfaları B5'te dolar.

export type Route =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'radio' }
  | { name: 'recentlyAdded' }
  | { name: 'artists' }
  | { name: 'albums' }
  | { name: 'songs' }
  | { name: 'genres' }
  | { name: 'composers' }
  | { name: 'compilations' }
  | { name: 'genre'; genre: string }
  | { name: 'composer'; composer: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string; title: string; artworkUrl: string | null; description?: string }
  | { name: 'album'; id: string; title: string; artworkUrl: string | null }
  | { name: 'artist'; id: string; title: string }
  | { name: 'search'; term: string }
  | { name: 'settings' }

interface Entry {
  route: Route
  /** Bu sayfadan ayrılırken ana ekranın kaydırma konumu. */
  scrollTop: number
}

interface RouterValue {
  route: Route
  canGoBack: boolean
  /** Yeni sayfaya gider; `scrollTop`: ayrılan sayfanın kaydırma konumu (geri gelince kullanılır). */
  navigate: (route: Route, scrollTop?: number) => void
  back: () => void
  /** Geri dönülen sayfanın kaydırma konumu (yeni sayfada 0). */
  restoreScroll: number
  /** Son geçişin yönü (karttan büyüyen sayfa geri dönüşte karta küçülür). */
  direction: 'forward' | 'back'
}

const RouterContext = createContext<RouterValue | null>(null)
const MAX_HISTORY = 50

export function RouterProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([{ route: { name: 'home' }, scrollTop: 0 }])
  const [restoreScroll, setRestoreScroll] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const navigate = useCallback((route: Route, scrollTop = 0) => {
    setStack((s) => {
      const current = s[s.length - 1]!
      if (sameRoute(current.route, route)) return s
      const updated = [...s.slice(0, -1), { ...current, scrollTop }, { route, scrollTop: 0 }]
      return updated.slice(-MAX_HISTORY)
    })
    setRestoreScroll(0)
    setDirection('forward')
  }, [])
  const back = useCallback(() => {
    setStack((s) => {
      if (s.length < 2) return s
      const previous = s[s.length - 2]!
      setRestoreScroll(previous.scrollTop)
      return s.slice(0, -1)
    })
    setDirection('back')
  }, [])
  const value = useMemo<RouterValue>(
    () => ({
      route: stack[stack.length - 1]!.route,
      canGoBack: stack.length > 1,
      navigate,
      back,
      restoreScroll,
      direction
    }),
    [stack, navigate, back, restoreScroll, direction]
  )
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('RouterProvider eksik')
  return value
}

export function routeKey(route: Route): string {
  switch (route.name) {
    case 'playlist':
    case 'album':
    case 'artist':
      return `${route.name}:${route.id}`
    case 'search':
      return `search:${route.term}`
    case 'genre':
      return `genre:${route.genre}`
    case 'composer':
      return `composer:${route.composer}`
    default:
      return route.name
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeKey(a) === routeKey(b)
}
