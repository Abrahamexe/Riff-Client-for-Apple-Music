// Uygulama ikonlarını build/icon.svg'den üretir (`npm run icons`; Electron ile çalışır, yeni bağımlılık
// yok). SVG her boyutta ayrı çizilir (küçültme değil), böylece 16 px'te de keskin kalır.
// Çıktılar: build/icon.ico (kurulum, kısayol, exe), build/icon.png (256 px),
// src/main/platform/appIcon.ts (tray + pencere ikonu). Çıktılar commit edilir; derleme bunu çalıştırmaz.

const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = join(__dirname, '..')
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const RUNTIME_SIZES = [16, 32, 64, 256]

async function rasterize(win, svg, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const result = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = ${size}
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, ${size}, ${size})
    const rgba = Array.from(g.getImageData(0, 0, ${size}, ${size}).data)
    return { png: c.toDataURL('image/png').split(',')[1], rgba }
  })()`)
  return { size, png: Buffer.from(result.png, 'base64'), rgba: Buffer.from(result.rgba) }
}

app
  .whenReady()
  .then(async () => {
    const { encodeIco, appIconModule } = await import(
      pathToFileURL(join(__dirname, 'icon-encode.mjs')).href
    )
    const svg = readFileSync(join(ROOT, 'build', 'icon.svg'), 'utf8')
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
    const images = []
    for (const size of ICO_SIZES) images.push(await rasterize(win, svg, size))
    writeFileSync(join(ROOT, 'build', 'icon.ico'), encodeIco(images))
    const bySize = Object.fromEntries(images.map((i) => [i.size, i.png]))
    writeFileSync(join(ROOT, 'build', 'icon.png'), bySize[256])
    const runtime = Object.fromEntries(RUNTIME_SIZES.map((s) => [s, bySize[s]]))
    writeFileSync(join(ROOT, 'src', 'main', 'platform', 'appIcon.ts'), appIconModule(runtime))
    console.log(`icons: ${ICO_SIZES.join(', ')} px → build/icon.ico, build/icon.png, appIcon.ts`)
    app.quit()
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
