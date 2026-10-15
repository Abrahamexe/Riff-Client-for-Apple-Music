import {
  app,
  BrowserWindow,
  clipboard,
  components,
  crashReporter,
  ipcMain,
  MessageChannelMain,
  net,
  safeStorage,
  screen,
  session,
  utilityProcess,
  type ComponentsError,
  type Rectangle,
  type WebPreferences
} from 'electron'
import { installProcessErrorHandlers } from '@shared/errors/global'
import { CoreError, logError } from '@shared/errors'
import { I18n } from '@shared/i18n'
import { AppleAuthorizer } from './apple-authorizer'
import { ArtworkCache } from './artworkCache'
import { authWindowOptions, hardenAuthWindow, noteAuthHost } from './auth-window'
import { AppLifecycle } from './app-lifecycle'
import { CdmStatusTracker } from './cdm'
import { createIpcHandlers, developerTokenInfo, registerIpcHandlers } from './ipc'
import { createPlaybackWarmup } from './playbackWarmup'
import { createDohProbe, createFastDns } from './fastDns'
import { APP_ENTRY_URL, APP_ORIGIN, SESSION_PARTITION } from './appOrigin'
import { PlayerHub } from './player-hub'
import { registerAppProtocolHandler, registerAppScheme } from './protocol'
import {
  applySessionPolicy,
  DEV_SERVER_URL,
  hardenWebContents,
  restrictToRenderer
} from './security'
import { acquireSingleInstance } from './single-instance'
import { decodeSession } from './storage/authSession'
import { SecureStore } from './storage/secureStore'
import { Supervisor } from './supervisor'
import { captureConsole, LogSink } from './logSink'
import { buildDiagnostics, diagnosticsFileName } from './diagnostics'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RemoteTokenProvider } from './token/RemoteTokenProvider'
import { UnavailableTokenProvider } from './token/UnavailableTokenProvider'
import type { TokenProvider } from './token/TokenProvider'
import { WindowRegistry } from './windows'
import { installWarningRedaction } from './warnings'
import { WorkerHost } from './worker-host'
import {
  applyAppIdentity,
  createAppTray,
  platformDescription,
  watchSystemResume,
  enableMediaKeyIntegration,
  onAppReactivate,
  onSystemSessionEnd,
  quitsWhenAllWindowsClosed,
  resolveAppPaths,
  openInDefaultBrowser,
  framelessWindowOptions,
  performWindowAction,
  watchWindowState,
  windowState,
  miniDefaultBounds,
  miniWindowOptions,
  setMiniOnTop,
  setupMiniWindow,
  removeApplicationMenu,
  windowIcon
} from './platform'

// Güvenlik kuralı 10: Electron/Node süreç uyarıları URL sorgusuyla (token) basılmasın — her şeyden önce.
installWarningRedaction()
// PLAN 2.3: yakalanmamış hatalar katalog koduyla loglanır; main çökmez.
installProcessErrorHandlers('main', process)
// PLAN 2.3: çökme dökümleri yalnızca yerelde (userData/Crashpad); hiçbir yere gönderilmez (izinli
// gönderim Faz 4.6). Dökümler bellek içerebilir: tanılama paketine girmez, çıkışta silinir (2.5).
crashReporter.start({ uploadToServer: false })

// Dev modda electron-vite renderer'ı Vite dev server'dan (localhost) servis eder;
// aksi halde (build/preview/paketli) app://renderer/ custom protocol'ünden. Dev server URL'si
// production build'inde hiç okunmaz (security.ts, __DEV_SERVER__).
const paths = resolveAppPaths(app, __dirname)

// PLAN 2.3: maskeli log dosyası (tanılama paketi). Main'in console çıktısı da buraya yazılır;
// worker ve ana pencerenin uyarı/hataları aşağıda bağlanır.
const logSink = new LogSink({ dir: paths.logs })
captureConsole(logSink, 'main')

// PLAN 1.8c: tek örnek kilidi, her şeyden ÖNCE. İkinci açılış mevcut ana pencereyi gösterir; kilidi
// alamayan süreç DB'ye, token dosyasına ve worker'a hiç dokunmadan çıkar (aşağıdaki başlatma işleri
// yalnızca birincil örnekte kaydedilir).
const isPrimaryInstance = acquireSingleInstance(app, () => {
  if (app.isReady()) showMainWindow()
})

/** Renderer sayfasının URL'si (dev server veya app://renderer). */
function pageUrl(page: string): string {
  return new URL(page, `${DEV_SERVER_URL ?? APP_ORIGIN}/`).toString()
}

// Özel şema, app ready olmadan ÖNCE kaydedilmelidir.
registerAppScheme()

// Güvenlik kuralı 2: tüm renderer'lar (sonradan açılan pencereler dahil) sandbox'ta çalışır.
app.enableSandbox()

// Güvenlik kuralı 7: oluşturulan HER webContents'e webview engeli ve varsayılan popup reddi.
app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

// Medya tuşları ve Windows medya overlay'i (SMTC): platform/ içinde.
enableMediaKeyIntegration(app.commandLine)
applyAppIdentity(app)

/** Tüm pencerelerimiz için ortak, değiştirilemez güvenlik ayarları (Güvenlik kuralı 2). */
const SECURE_WEB_PREFERENCES: WebPreferences = {
  preload: paths.preload,
  partition: SESSION_PARTITION,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  // R4: yayın derlemesinde geliştirici araçları açılamaz (token MusicKit belleğinde durur).
  devTools: __DEV_BUILD__
}

const windows = new WindowRegistry()
// ECS: Widevine CDM kurulumu (ilk açılışta indirme) arka planda beklenir; pencere bunu BEKLEMEZ
// (PLAN 1.2R). Durum `cdm:status` ile renderer'a bildirilir, çalma CDM hazır olana kadar bekletilir.
const cdm = new CdmStatusTracker()
// PLAN 1.8c: MusicKit veya CDM hazır değilken gelen komut PLAYER_NOT_READY ile reddedilir.
const hub = new PlayerHub(windows, { isCdmReady: () => cdm.current().state === 'ready' })
let fastDns: ReturnType<typeof createFastDns> | null = null
let worker: WorkerHost | null = null

// PLAN 2.3: çökme gözetimi. Ana pencerenin renderer'ı çökerse pencere yeniden yüklenir (oturum ve
// kuyruk açılıştaki gibi geri gelir); worker çökerse yeniden başlatılır. Döngüde güvenli mod.
const supervisor = new Supervisor({
  reloadMainWindow: () => {
    const main = windows.main()
    if (main && !main.isDestroyed()) BrowserWindow.fromId(main.id)?.webContents.reload()
  },
  restartWorker: () => worker?.restart(),
  enterSafeMode: () => {
    worker?.setSafeMode(true)
    logError('supervisor', new CoreError('SAFE_MODE_ENABLED', 'Güvenli mod açıldı.'))
  }
})
// Tray referansı tutulmazsa çöp toplayıcı ikonu kaldırabilir.
let disposeTray: (() => void) | null = null

// Gerçek çıkış: tray "Çıkış", uygulama menüsü veya sistem kapanışı (PLAN 1.8a). Çıkıştan önce son
// player durumu main'deki hub'dan worker'a kaydedilir (renderer donmuş/kapanmış olsa bile).
const lifecycle = new AppLifecycle({
  quit: () => app.quit(),
  flush: async () => {
    const state = hub.persistableState()
    if (state && worker) await worker.savePlayerState(state)
  }
})
if (isPrimaryInstance) {
  app.on('before-quit', (event) => lifecycle.onBeforeQuit(event))
  app.on('will-quit', () => {
    disposeTray?.()
    worker?.stop()
  })
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    // B1: Windows başlık çubuğu yok; kendi çubuğumuz arayüzde (main/platform/windowControls.ts).
    ...framelessWindowOptions(),
    icon: windowIcon(),
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // MusicKit bu pencerede çalışır; gizliyken de şarkı geçişi ve SMTC sürmeli. Chromium sesli
      // sayfaları yoğun kısıtlamadan muaf tutar. V7 ölçümü (docs/PERFORMANCE.md): gizli/simge
      // durumunda çalma, geçiş ve medya tuşları sorunsuz; CPU ~%45 düşük → true kalır.
      backgroundThrottling: true
    }
  })
  windows.register(win, 'main')
  // R2: ağ değişmiş olabilir (DoH engelli ağa geçiş); en sık dakikada bir yoklanır.
  win.on('focus', () => void fastDns?.recheck())
  watchWindowState(win, (state) => windows.send(win, 'onWindowState', state))

  win.once('ready-to-show', () => win.show())
  // Kapat (X): varsayılan çıkış (önce player durumu kaydedilir); "gizle" tercihinde tray'e gizler.
  win.on('close', (event) => lifecycle.onMainWindowClose(event, () => win.hide()))
  onSystemSessionEnd(win, () => lifecycle.onSessionEnd())
  // Ana pencere yeniden yüklenir/çöker/kapanırsa eski player durumu geçersizdir (komutlar
  // PLAYER_NOT_READY ile reddedilir, PLAN 1.8c).
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) hub.reset()
  })
  win.on('closed', () => {
    hub.reset()
    // Ana pencere giderse (çıkış) MiniPlayer da kapanır; aksi halde uygulama açık kalırdı.
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy()
  })
  win.webContents.on('render-process-gone', (_event, details) => supervisor.onRendererGone(details))
  // Renderer'ın uyarı/hataları ve kapsamlı logları (`[scope] …`) log dosyasına (PLAN 2.3).
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error' || event.message.startsWith('[')) {
      logSink.write('renderer', event.level, event.message)
    }
  })
  win.on('unresponsive', () =>
    logError('supervisor', new CoreError('RENDERER_CRASHED', 'Ana pencere yanıt vermiyor.'))
  )

  // Güvenlik kuralı 7: harici navigasyon/yönlendirme engellenir; ana pencere popup açamaz (Apple
  // girişi main'in açtığı ayrı pencerede, apple-authorizer.ts).
  restrictToRenderer(win.webContents)

  void win.loadURL(DEV_SERVER_URL ?? APP_ENTRY_URL)
}

/** Ana pencereyi gösterir ve öne getirir; yoksa oluşturur (tray, ikinci açılış, macOS dock). */
function showMainWindow(): void {
  if (!windows.showMain()) createMainWindow()
}

// B12b MiniPlayer (geliştirici kararı 2026-10-14): açılınca ana pencere gizlenir (Apple Music gibi);
// kapatma / büyütme düğmesi veya çift tık ana pencereyi geri getirir. Konumu oturum boyunca hatırlanır.
let miniWindow: BrowserWindow | null = null
let miniBounds: Rectangle | null = null

function openMiniPlayer({ alwaysOnTop }: { alwaysOnTop: boolean }): void {
  const ownMain = windows.main()
  const main = ownMain ? BrowserWindow.fromId(ownMain.id) : null
  if (miniWindow && !miniWindow.isDestroyed()) {
    setMiniOnTop(miniWindow, alwaysOnTop)
    miniWindow.show()
    miniWindow.focus()
    main?.hide()
    return
  }
  const area = screen.getDisplayMatching(
    main?.getBounds() ?? { x: 0, y: 0, width: 1, height: 1 }
  ).workArea
  const win = new BrowserWindow({
    ...miniWindowOptions(miniBounds ?? miniDefaultBounds(area), alwaysOnTop),
    icon: windowIcon(),
    webPreferences: SECURE_WEB_PREFERENCES
  })
  miniWindow = win
  windows.register(win, 'aux')
  restrictToRenderer(win.webContents)
  setupMiniWindow(win, () => win.close())
  win.once('ready-to-show', () => {
    win.show()
    // Bayrak gösterimden sonra yeniden uygulanır. Duman testinde isAlwaysOnTop() bazen false okundu
    // (ortama bağlı, nedeni belirsiz); davranış elle doğrulanır (docs/MANUAL_TESTS.md).
    setMiniOnTop(win, alwaysOnTop)
    main?.hide()
  })
  win.on('close', () => {
    miniBounds = win.getBounds()
  })
  win.on('closed', () => {
    miniWindow = null
    // Yalnızca var olan ana pencere gösterilir (çıkış sırasında yenisi açılmasın).
    windows.showMain()
  })
  void win.loadURL(pageUrl('mini.html'))
}

/** Çağıran çerçeve MiniPlayer'ın kendisiyse kapatır (ana pencere `closed`'da geri gelir). */
function closeMiniPlayer(frame: { processId: number; routingId: number }): boolean {
  const own = windows.windowForFrame(frame)
  if (!own || !miniWindow || miniWindow.isDestroyed() || own.id !== miniWindow.id) return false
  miniWindow.close()
  return true
}

cdm.onChange((status) => {
  console.log('[components] status:', JSON.stringify(components.status()))
  // Yalnızca kendi içeriğimize gönderilir (Apple giriş penceresine değil).
  windows.broadcast('onCdmStatus', status)
})

async function waitForComponents(): Promise<void> {
  try {
    const results = await components.whenReady()
    console.log('[components] ready:', JSON.stringify(results))
  } catch (err) {
    const errors = (err as Partial<ComponentsError>).errors
    logError('components', err, 'DRM_UNAVAILABLE', 'Widevine CDM kurulamadı (whenReady).')
    if (errors) console.error('[components] errors:', JSON.stringify(errors))
    throw err
  }
}

// Developer token sağlayıcısı (PLAN 1.10, 4.1):
//  - Derlemede `AM_TOKEN_SERVICE_URL` verildiyse: RemoteTokenProvider (`.p8` yalnızca sunucuda).
//  - Yoksa dev build: .env / .p8 (proje kökü; paketli dev build: userData/.env). Production'da
//    `__DEV_BUILD__` false olduğundan bu dal ve DevTokenProvider bundle'a hiç girmez.
//  - İkisi de yoksa: sağlayıcı yok (TOKEN_PROVIDER_UNAVAILABLE).
async function createTokenProvider(): Promise<TokenProvider> {
  if (__TOKEN_SERVICE_URL__) {
    return new RemoteTokenProvider({ url: __TOKEN_SERVICE_URL__, appVersion: __APP_VERSION__ })
  }
  if (__DEV_BUILD__) {
    const { createDevTokenProviderFor } = await import('./token/devToken')
    return createDevTokenProviderFor(app)
  }
  return new UnavailableTokenProvider()
}

// Worker (utilityProcess): SQLite, senkronizasyon, Apple API ve arka plan kaynakları (PLAN 1.7a, 3.A).
function startWorker(tokenProvider: TokenProvider): WorkerHost {
  const host = new WorkerHost({
    dbPath: paths.libraryDb,
    artworkDir: paths.artworkCache,
    onFastDns: (enabled) => fastDns?.setEnabled(enabled),
    fork: () => {
      // stdio 'pipe': worker çıktısı log dosyasına da gider (konsola aynen yansıtılır).
      const child = utilityProcess.fork(paths.workerScript, [], {
        serviceName: 'Riff Client Worker',
        stdio: 'pipe'
      })
      const forward = (level: string) => (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        process.stdout.write(`[worker] ${text}`)
        for (const line of text.split(/\r?\n/)) if (line) logSink.write('worker', level, line)
      }
      child.stdout?.on('data', forward('info'))
      child.stderr?.on('data', forward('error'))
      return child
    },
    createChannel: () => new MessageChannelMain(),
    getDeveloperToken: async (refresh) => {
      try {
        if (refresh) tokenProvider.invalidate()
        return { ok: true, value: await developerTokenInfo(tokenProvider) }
      } catch (err) {
        if (err instanceof CoreError) return { ok: false, error: err.toWire() }
        logError('worker', err, 'INTERNAL', 'Developer token alınamadı.')
        return { ok: false, error: { code: 'INTERNAL', message: 'Developer token alınamadı.' } }
      }
    },
    onUnexpectedExit: (code) => supervisor.onWorkerExit(code),
    // 2.7 O1: worker çalışmıyorken çıkış silmesi (DB dosyaları kapalı).
    removeDatabaseFiles: async () => {
      for (const suffix of ['', '-wal', '-shm']) await rm(paths.libraryDb + suffix, { force: true })
    }
  })
  host.start()
  return host
}

async function startPrimaryInstance(): Promise<void> {
  await app.whenReady()
  // R4: Electron'un varsayılan menüsü kaldırılır. Çerçevesiz pencerede görünmese de kısayolları
  // çalışıyordu (ölçüldü: Ctrl+Shift+I geliştirici araçlarını açtı; Ctrl+R yeniden yükler).
  removeApplicationMenu()
  // R2: Hızlı DNS (fastDns.ts) — pencere, MusicKit ve kapak isteklerinden önce kurulur.
  fastDns = createFastDns({
    configure: (config) => app.configureHostResolver(config),
    probe: createDohProbe((url, init) => net.fetch(url, init))
  })
  const appSession = session.fromPartition(SESSION_PARTITION)
  applySessionPolicy(appSession)
  // 2.2: kapak görseli disk önbelleği. A3.2: main yalnızca diskten sunar; indirme, yazma ve boyut
  // süpürmesi worker'da (worker aşağıda başlatılır; o ana kadar gelen istek hazır olmasını bekler).
  const artwork = new ArtworkCache({
    dir: paths.artworkCache,
    fetchFromWorker: (url) => worker?.fetchArtwork(url) ?? Promise.resolve('unavailable')
  })
  registerAppProtocolHandler(appSession, paths.rendererRoot, artwork)
  const i18n = new I18n(app.getPreferredSystemLanguages())
  const tokenProvider = await createTokenProvider()
  const userTokenStore = new SecureStore(paths.authFile, safeStorage)
  const workerHost = startWorker(tokenProvider)
  worker = workerHost
  // PLAN 1.5 hazırlık (yalnızca dev build): `--scan-plaintext` ile userData'da şifresiz token taraması.
  if (__DEV_BUILD__ && process.argv.includes('--scan-plaintext')) {
    import('./dev/plaintextCheck')
      .then(({ runPlaintextCheck }) => runPlaintextCheck(paths.userData, userTokenStore))
      .catch((err: unknown) => logError('1.5 tarama', err))
  }
  // PLAN 1.8b ölçümü (yalnızca dev build): `--cpu-sample` ile süreç CPU kullanımı loglanır.
  if (__DEV_BUILD__ && process.argv.includes('--cpu-sample')) {
    import('./dev/cpuSampler')
      .then(({ startCpuSampler }) =>
        startCpuSampler(
          () => app.getAppMetrics(),
          () => windows.main()?.isVisible() ?? false
        )
      )
      .catch((err: unknown) => logError('cpu', err))
  }
  // Worker, kütüphane isteklerinde kullanıcı token'ına ihtiyaç duyar; renderer'a gerek kalmadan verilir.
  userTokenStore.load().then(
    (stored) => workerHost.setUserToken(decodeSession(stored)?.token ?? null),
    (err: unknown) => logError('auth', err, 'UNKNOWN', 'Kayıtlı oturum worker için yüklenemedi.')
  )
  // V3: Apple girişi opener'sız ayrı pencerede; token geri dönüş navigasyonundan alınır.
  const authorizer = new AppleAuthorizer({
    appName: 'Riff Client',
    getDeveloperToken: () => tokenProvider.getDeveloperToken(),
    onHost: noteAuthHost,
    createWindow: () => {
      const mainId = windows.main()?.id
      const parent = mainId === undefined ? undefined : (BrowserWindow.fromId(mainId) ?? undefined)
      const authWin = new BrowserWindow(authWindowOptions(parent, SESSION_PARTITION))
      hardenAuthWindow(authWin)
      return authWin
    }
  })
  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      tokenProvider,
      authorizer,
      // PLAN 2.5: çıkış = tam temizlik (token ve DB ayrıca silinir).
      localFiles: {
        clear: async () => {
          const results = await Promise.allSettled([
            artwork.clear(),
            logSink.clear(),
            rm(paths.crashDumps, { recursive: true, force: true })
          ])
          const failed = results.find((r) => r.status === 'rejected')
          // 2.7 O1: başarısız silme sessizce yutulmaz (çağıran IPC hatayı bildirir).
          if (failed) throw failed.reason
          console.info('[privacy] çıkış: kapak önbelleği, loglar ve çökme dökümleri silindi')
        }
      },
      artworkCache: artwork,
      // P4: adres ipc.ts'te externalLinkUrl ile doğrulanır (yalnızca https + izinli host).
      openExternal: openInDefaultBrowser,
      writeClipboard: (text) => clipboard.writeText(text),
      // 2026-10-14: yavaş DNS'te (TTL=0, 2–6 sn) ilk çalma 4–9 sn sürüyordu; ön bağlantı ~0,3 sn.
      warmupPlayback: createPlaybackWarmup({
        preconnect: (url) => appSession.preconnect({ url, numSockets: 1 })
      }),
      diagnostics: {
        export: async () => {
          const zip = await buildDiagnostics({
            sink: logSink,
            versions: {
              app: __APP_VERSION__,
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              node: process.versions.node,
              os: platformDescription()
            },
            cdm: cdm.current(),
            safeMode: supervisor.safeMode
          })
          const fileName = diagnosticsFileName(new Date())
          await writeFile(join(paths.downloads, fileName), zip)
          console.info('[diagnostics] tanılama paketi yazıldı (İndirilenler)')
          return { fileName }
        }
      },
      userTokenStore,
      cdm,
      worker: workerHost,
      hub,
      windows: {
        isMainWindowFrame: (frame) => windows.isMainWindowFrame(frame),
        openMiniPlayer,
        closeMiniPlayer,
        // B1: kendi pencere çubuğu; yalnızca kayıtlı pencerelerimiz (Apple giriş penceresi değil).
        controlWindow: (frame, action) => {
          const own = windows.windowForFrame(frame)
          const win = own ? BrowserWindow.fromId(own.id) : null
          if (!win) return false
          performWindowAction(win, action)
          return true
        },
        windowState: (frame) => {
          const own = windows.windowForFrame(frame)
          const win = own ? BrowserWindow.fromId(own.id) : null
          return win ? windowState(win) : null
        }
      }
    })
  )
  createMainWindow()
  void cdm.track(waitForComponents)

  // Tray yalnızca "kapatınca gizle" tercihinde (varsayılan: X çıkar, V6 kararı); ayar Faz 3.B3.
  if (lifecycle.closeBehavior === 'hide') {
    disposeTray = createAppTray(i18n, {
      show: showMainWindow,
      command: (command) => {
        try {
          hub.command(command)
        } catch (err) {
          logError('tray', err)
        }
      },
      quit: () => lifecycle.requestQuit()
    })
  }

  onAppReactivate(app, showMainWindow)
  // PLAN 2.3: uykudan uyanınca pencereler ağı, senkronu ve MusicKit'i yeniden denetler.
  watchSystemResume(() => {
    void fastDns?.recheck(true)
    windows.broadcast('onSystemResume', { reason: 'resume' })
  })
}

if (isPrimaryInstance) {
  startPrimaryInstance().catch((err: unknown) =>
    logError('app', err, 'INTERNAL', 'Başlatma başarısız.')
  )
}

app.on('window-all-closed', () => {
  if (quitsWhenAllWindowsClosed()) app.quit()
})
