// Görev çubuğu küçük resim düğmelerinin ikonlarını üretir (`npm run icons:thumbar`; Electron ile çalışır,
// yeni bağımlılık yok). Çizimler oynatıcıdaki Lucide ikonlarıyla aynı (dolgulu, çizgi 1,5). Her boyut
// ayrı çizilir: 16 px (%100), 24 px (%150), 32 px (%200). İki renk: açık glif koyu görev çubuğu için,
// koyu glif açık görev çubuğu için. Çıktı: src/main/platform/thumbarIcons.ts (commit edilir).

const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const SIZES = [16, 24, 32]
const COLORS = { light: '#ffffff', dark: '#1c1c1e' }

// Lucide (ISC) play, pause, skip-back, skip-forward — lucide-react 1.56.
const GLYPHS = {
  previous:
    '<path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z"/><path d="M3 20V4"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  pause:
    '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  next: '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>'
}

const svg = (body, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="${color}" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

async function rasterize(win, source, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`
  return win.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = ${size}
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png').split(',')[1]
  })()`)
}

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
    const out = [
      '// ÜRETİLMİŞ DOSYA — elle düzenleme. Üretici: `npm run icons:thumbar`',
      '// (scripts/make-thumbar-icons.cjs). Görev çubuğu düğmeleri için PNG (base64): tema → glif → boyut.',
      '',
      "export type ThumbarGlyph = 'previous' | 'play' | 'pause' | 'next'",
      "export type ThumbarTone = 'light' | 'dark'",
      '',
      'export const THUMBAR_PNG: Readonly<',
      '  Record<ThumbarTone, Record<ThumbarGlyph, Readonly<Record<number, string>>>>',
      '> = {'
    ]
    for (const [tone, color] of Object.entries(COLORS)) {
      out.push(`  ${tone}: {`)
      for (const [name, body] of Object.entries(GLYPHS)) {
        const lines = []
        for (const size of SIZES)
          lines.push(`      ${size}: '${await rasterize(win, svg(body, color), size)}'`)
        out.push(`    ${name}: {`, lines.join(',\n'), '    },')
      }
      out.push('  },')
    }
    out.push('}', '')
    writeFileSync(join(ROOT, 'src', 'main', 'platform', 'thumbarIcons.ts'), out.join('\n'))
    console.log(
      `thumbar: ${Object.keys(GLYPHS).length} glif × 2 renk × ${SIZES.join('/')} px → thumbarIcons.ts`
    )
    app.quit()
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
