import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// R4 (2026-10-15) bulgusu: Electron'un varsayılan menüsü kaldırılmamıştı; çerçevesiz pencerede
// Ctrl+Shift+I geliştirici araçlarını açıyordu (MusicKit token'ı orada okunabilir). Kaynak metin denetimi.

const ROOT = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

describe('geliştirici araçları ve uygulama menüsü (R4)', () => {
  it('varsayılan menü pencere açılmadan kaldırılır', () => {
    expect(read('src/main/platform/index.ts')).toContain('Menu.setApplicationMenu(null)')
    const src = read('src/main/index.ts')
    const removed = src.indexOf('removeApplicationMenu()')
    expect(removed).toBeGreaterThan(src.indexOf('await app.whenReady()'))
    expect(removed).toBeLessThan(src.indexOf('createMainWindow()', removed))
  })

  it('her pencerenin webPreferences’ı devTools’u yalnızca dev build’de açar', () => {
    const main = read('src/main/index.ts')
    const prefs = main.slice(main.indexOf('const SECURE_WEB_PREFERENCES'))
    expect(prefs.slice(0, prefs.indexOf('\n}'))).toMatch(/devTools: __DEV_BUILD__/)
    // Apple giriş penceresi ve onun açtığı iç pencere.
    const auth = read('src/main/auth-window.ts')
    expect(auth.match(/devTools: __DEV_BUILD__/g)).toHaveLength(2)
    expect(auth.match(/webPreferences: \{/g)).toHaveLength(2)
  })
})
