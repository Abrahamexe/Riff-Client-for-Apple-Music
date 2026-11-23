import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/settings'
import type { WindowState } from '@shared/ipc-contract'
import type { App } from '../app/bootstrap'

// Arayüzün çekirdeğe tek kapısı (PLAN_v5 B1): `App` (app/bootstrap.ts) bağlamla verilir; bileşenler
// çekirdek servislerini buradan kullanır, IPC'yi doğrudan çağırmaz (pencere çubuğu hariç: dar API).

const AppContext = createContext<App | null>(null)

export function AppProvider({ app, children }: { app: App; children: ReactNode }) {
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>
}

export function useApp(): App {
  const app = useContext(AppContext)
  if (!app) throw new Error('AppProvider eksik')
  return app
}

/** Ayarlar (yüklenene kadar `null`); başka pencereden gelen değişiklik de yansır. */
export function useSettings(): Settings | null {
  const app = useApp()
  const [settings, setSettings] = useState<Settings | null>(app.settings.current)
  useEffect(() => {
    setSettings(app.settings.current)
    return app.settings.onChange(setSettings)
  }, [app])
  return settings
}

/** Pencere büyütülmüş mü / odakta mı (kendi pencere çubuğumuz için). */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true })
  useEffect(() => {
    let alive = true
    void window.api.getWindowState().then((res) => {
      if (alive && res.ok) setState(res.value)
    })
    const off = window.api.onWindowState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** Oturum açık mı (B8); açılışta geri yükleme bitene kadar `null`. */
export function useSignedIn(): boolean | null {
  const app = useApp()
  const [signedIn, setSignedIn] = useState<boolean | null>(app.signedIn)
  useEffect(() => {
    setSignedIn(app.signedIn)
    const offSession = app.on('session', (s) => setSignedIn(s.authorized))
    const offUnauthorized = app.on('unauthorized', () => setSignedIn(false))
    return () => {
      offSession()
      offUnauthorized()
    }
  }, [app])
  return signedIn
}
