// E2E harness (PLAN 2.6): Electron ana script'i. Derlenmiş uygulamayı (`out/main/index.js`, build:dev)
// izole bir profille yükler ve `E2E_SCENARIO` senaryosunu çalıştırır; sonucu `E2E_RESULT {json}`
// satırıyla basar. Gizlilik ve bağımsızlık:
//  - Projenin .env/.p8'i OKUNMAZ: geçici bir P-256 anahtarı üretilir, sahte Team/Key ID ile verilir
//    (yalnızca yerelde JWT imzalanır; Apple'a gitmez).
//  - MusicKit sahte betikle değiştirilir; renderer'ın diğer tüm dış istekleri kesilir (503).
//  - Worker giriş yapılmadığı için Apple'a istek atmaz; sahte şarkılarda sanatçı boş olduğundan arka
//    plan katmanı da kaynaklara gitmez.
const path = require('node:path')
const fs = require('node:fs')
const { generateKeyPairSync } = require('node:crypto')
const { app, session, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..', '..')
const DIR = process.env.E2E_DIR
const SCENARIO = process.env.E2E_SCENARIO
const MUSICKIT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-musickit.browser.js'), 'utf8')
const t = () => Math.round(process.uptime() * 1000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const result = { scenario: SCENARIO }
let printed = false
const done = (extra = {}) => {
  if (printed) return
  printed = true
  process.stdout.write(`\nE2E_RESULT ${JSON.stringify({ ...result, ...extra })}\n`)
}

// İzole profil + sahte developer anahtarı (appPath'te .env yok → yalnızca bu ortam kullanılır).
app.setPath('userData', path.join(DIR, 'userdata'))
app.setPath('downloads', path.join(DIR, 'downloads'))
app.getAppPath = () => DIR
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = path.join(DIR, 'e2e-key.p8')
fs.writeFileSync(pem, privateKey.export({ type: 'pkcs8', format: 'pem' }))
process.env.APPLE_TEAM_ID = 'E2ETEAM001'
process.env.APPLE_KEY_ID = 'E2EKEY0001'
process.env.APPLE_PRIVATE_KEY_PATH = pem

app.on('ready', () => {
  result.appReady = t()
  session
    .fromPartition('am-client')
    .protocol.handle('https', (request) =>
      request.url === MUSICKIT_URL
        ? new Response(FAKE, { headers: { 'content-type': 'text/javascript' } })
        : new Response('', { status: 503 })
    )
})
app.on('browser-window-created', (_e, w) => {
  if (result.windowCreated) return
  result.windowCreated = t()
  w.once('show', () => (result.windowShown = t()))
})
app.on('will-quit', () => {
  result.willQuit = true
  done()
})
app.on('second-instance', () => (result.secondInstanceSeen = true))

require(path.join(ROOT, 'out', 'main', 'index.js'))

const mainWindow = () =>
  BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('index.html'))
const js = (w, code) => w.webContents.executeJavaScript(code, true)
async function waitFor(fn, timeoutMs = 15_000, step = 10) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await fn().catch(() => undefined)
    if (v) return v
    await sleep(step)
  }
  throw new Error('zaman aşımı')
}
const panelLog = (w) => js(w, `document.querySelector('#log')?.textContent ?? ''`)
const read = (w) =>
  js(w, `window.api.worker.getPlaylists({}).then(r => r.ok ? 'ok' : r.error.code)`)
const workerPid = () =>
  app.getAppMetrics().find((m) => m.type === 'Utility' && /Node/i.test(m.serviceName || ''))?.pid

const scenarios = {
  // Açılış: pencere, yerel kütüphane okuması, MusicKit hazır (bütçe kontrolü runner'da).
  async startup() {
    const w = await waitFor(async () => mainWindow())
    await waitFor(async () => (await read(w)) === 'ok')
    result.libraryVisible = t()
    await waitFor(async () => /MusicKit\.getInstance\(\) döndü/.test(await panelLog(w)))
    result.musicKitReady = t()
  },

  // player-hub: yardımcı pencereden (MiniPlayer) komut → ana penceredeki MusicKit çalar → durum yayınlanır.
  async hub() {
    const w = await waitFor(async () => mainWindow())
    await waitFor(async () => /MusicKit\.getInstance\(\) döndü/.test(await panelLog(w)))
    await js(
      w,
      `MusicKit.getInstance().setQueue({ songs: ['e2e-1', 'e2e-2'], startPlaying: false }).then(() => 1)`
    )
    // Widevine CDM yeni profilde önce iner; hub hazır olmadan komutu PLAYER_NOT_READY ile reddeder.
    await waitFor(
      () => js(w, `window.api.getCdmStatus().then(r => r.ok && r.value.state === 'ready')`),
      90_000,
      250
    )
    // Yardımcı pencere: MiniPlayer (hub üzerinden durum alır, komut gönderir).
    await js(w, `window.api.openMiniPlayer({ alwaysOnTop: false }).then(r => r.ok)`)
    const aux = await waitFor(async () =>
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('mini.html'))
    )
    await waitFor(async () => !aux.webContents.isLoading())
    result.commandResult = await js(
      aux,
      `window.api.sendPlayerCommand({ type: 'play' }).then(r => r.ok ? 'ok' : r.error.code)`
    )
    result.auxState = await waitFor(() =>
      js(
        aux,
        `window.api.getPlayerState().then(r => r.value.state && r.value.state.playbackState === 'playing' ? r.value.state.playbackState : null)`
      )
    )
    result.next = await js(aux, `window.api.sendPlayerCommand({ type: 'next' }).then(r => r.ok)`)
    result.auxPosition = await waitFor(() =>
      js(
        aux,
        `window.api.getPlayerState().then(r => r.value.state && r.value.state.queue.position === 1 ? 1 : null)`
      )
    )
  },

  // Çökme toparlanması: worker ve renderer.
  async crash() {
    const w = await waitFor(async () => mainWindow())
    await waitFor(async () => (await read(w)) === 'ok')
    const pid = workerPid()
    process.kill(pid)
    result.readDuringWorkerCrash = await read(w)
    result.readAfterWorkerRestart = await waitFor(async () =>
      (await read(w)) === 'ok' ? 'ok' : null
    )
    result.workerRestarted = workerPid() !== pid
    w.webContents.forcefullyCrashRenderer()
    await sleep(1500)
    await waitFor(async () => /MusicKit\.getInstance\(\) döndü/.test(await panelLog(w)), 20_000)
    result.rendererRecovered = true
    result.readAfterRendererCrash = await read(w)
  },

  // Kabuk tıklamaları: üst şeritteki yüzen denetimler (hamburger, arama) pencere sürükleme şeridinin
  // altında kalmamalı; gerçek fare tıklaması menüyü kapatıp açar.
  async shell() {
    const w = await waitFor(async () => mainWindow())
    w.setSize(1440, 900)
    await waitFor(() => js(w, `!!document.querySelector('.sidebar__toggle')`))
    await sleep(500)
    const hit = (selector) =>
      js(
        w,
        `(() => { const t = document.querySelector('${selector}'); if (!t) return 'yok'; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!e && t.contains(e) })()`
      )
    result.toggleHit = await hit('.sidebar__toggle')
    result.searchHit = await hit('.searchbar__input')
    const expanded = () =>
      js(w, `document.querySelector('.sidebar__toggle').getAttribute('aria-expanded')`)
    const click = async () => {
      const { x, y } = await js(
        w,
        `(() => { const r = document.querySelector('.sidebar__toggle').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`
      )
      w.focus()
      w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      await sleep(800)
    }
    result.menuBefore = await expanded()
    await click()
    result.menuAfterClose = await expanded()
    await click()
    result.menuAfterOpen = await expanded()
  },

  // X: uygulamadan çıkar (varsayılan, V6 kararı).
  async quit() {
    const w = await waitFor(async () => mainWindow())
    await waitFor(async () => !w.webContents.isLoading())
    w.close()
    await sleep(8000)
    result.stillRunning = true // buraya gelindiyse çıkılmadı
  },

  // Tek örnek: ikinci açılış bekletilir; runner ikinci süreci başlatır.
  async hold() {
    const w = await waitFor(async () => mainWindow())
    await waitFor(async () => !w.webContents.isLoading())
    fs.writeFileSync(path.join(DIR, 'ready.flag'), '1')
    await waitFor(async () => result.secondInstanceSeen, 20_000, 100)
    await sleep(500)
    result.mainVisible = w.isVisible()
  }
}

;(async () => {
  await app.whenReady()
  try {
    if (!scenarios[SCENARIO]) throw new Error(`bilinmeyen senaryo: ${SCENARIO}`)
    await scenarios[SCENARIO]()
    done()
    app.exit(0)
  } catch (err) {
    done({ error: String(err && err.message) })
    app.exit(1)
  }
})()
