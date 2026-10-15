import { installWindowErrorHandlers } from '@shared/errors/global'
import { App } from './app/bootstrap'

// PLAN 2.3: yakalanmamış hatalar katalog koduyla loglanır (main'in log dosyasına da gider).
installWindowErrorHandlers('renderer', window)

// PLAN_v5 P6: uygulama kabuğu UI'dan bağımsız başlar. Debug paneli yalnızca dev build'de yüklenir
// (`__DEV_BUILD__` false iken bu dal ve panel modülü bundle'a girmez); arayüz (Faz B) `app`'i
// aynı şekilde tüketecek.
const app = new App({ name: 'Riff Client', build: __APP_VERSION__ })

async function boot(): Promise<void> {
  // Arayüz (Faz B): start'tan önce bağlanır ki açılış olaylarını (oturum, kuyruk) kaçırmasın.
  const uiRoot = document.getElementById('ui-root')
  if (uiRoot) {
    const { mountUi } = await import('./ui/mount')
    mountUi(uiRoot, app)
  }
  if (__DEV_BUILD__) {
    const { mountDebugPanel } = await import('./debug/panel')
    const root = document.getElementById('app')
    if (root) mountDebugPanel(root, app) // start'tan önce: açılış olayları da loglansın
  }
  await app.start()
}

void boot()
