import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useRouter, type Route } from './router'

// Ana ekranın kaydırma kabı (B4): sanal listeler görünür aralığı bundan hesaplar; sayfa değişirken
// kaydırma konumu geçmişe yazılır (geri dönünce geri gelir).

const MainScrollContext = createContext<HTMLElement | null>(null)

export function MainScrollProvider({
  element,
  children
}: {
  element: HTMLElement | null
  children: ReactNode
}) {
  return <MainScrollContext.Provider value={element}>{children}</MainScrollContext.Provider>
}

export function useMainScroll(): HTMLElement | null {
  return useContext(MainScrollContext)
}

/** Sayfaya git; ayrılan sayfanın kaydırma konumu saklanır. */
export function useGo(): (route: Route) => void {
  const { navigate } = useRouter()
  const main = useMainScroll()
  return useCallback((route: Route) => navigate(route, main?.scrollTop ?? 0), [navigate, main])
}
