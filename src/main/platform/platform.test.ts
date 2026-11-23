import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { devEnvFilePath } from './devPaths'
import {
  APP_USER_MODEL_ID,
  applyAppIdentity,
  enableMediaKeyIntegration,
  onAppReactivate,
  onSystemSessionEnd,
  quitsWhenAllWindowsClosed,
  resolveAppPaths,
  watchSystemResume
} from './index'

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}
afterEach(() => setPlatform(realPlatform))

const app = (isPackaged: boolean) => ({
  getPath: (name: string) =>
    name === 'userData' ? join('U', 'AppData', 'am-client') : join('U', name),
  getAppPath: () => join('C', 'proje'),
  isPackaged
})

describe('yollar', () => {
  it('kullanıcı verisi userData altında; derlenmiş dosyalar main klasörüne göre', () => {
    const p = resolveAppPaths(app(true), join('A', 'out', 'main'))
    expect(p.libraryDb).toBe(join('U', 'AppData', 'am-client', 'library.db'))
    expect(p.authFile).toBe(join('U', 'AppData', 'am-client', 'auth.bin'))
    expect(p.artworkCache).toBe(join('U', 'AppData', 'am-client', 'artwork'))
    expect(p.rendererRoot).toBe(join('A', 'out', 'renderer'))
    expect(p.preload).toBe(join('A', 'out', 'preload', 'index.js'))
    expect(p.workerScript).toBe(join('A', 'out', 'main', 'worker.js'))
    expect(p.downloads).toBe(join('U', 'downloads'))
    expect(p.crashDumps).toBe(join('U', 'crashDumps'))
  })

  it('dev .env: geliştirmede proje kökü, paketli dev build’de userData', () => {
    expect(devEnvFilePath(app(false))).toBe(join('C', 'proje', '.env'))
    expect(devEnvFilePath(app(true))).toBe(join('U', 'AppData', 'am-client', '.env'))
  })
})

describe('platform davranışları', () => {
  it('Windows: tüm pencereler kapanınca çık; session-end dinlenir; activate dinlenmez', () => {
    setPlatform('win32')
    expect(quitsWhenAllWindowsClosed()).toBe(true)
    const win = { on: vi.fn() }
    onSystemSessionEnd(win, () => {})
    expect(win.on).toHaveBeenCalledWith('session-end', expect.any(Function))
    const a = { on: vi.fn() }
    onAppReactivate(a, () => {})
    expect(a.on).not.toHaveBeenCalled()
  })

  it('macOS: dock’ta açık kalır, activate ile pencere geri gelir', () => {
    setPlatform('darwin')
    expect(quitsWhenAllWindowsClosed()).toBe(false)
    const a = { on: vi.fn() }
    onAppReactivate(a, () => {})
    expect(a.on).toHaveBeenCalledWith('activate', expect.any(Function))
    const win = { on: vi.fn() }
    onSystemSessionEnd(win, () => {})
    expect(win.on).not.toHaveBeenCalled()
  })

  it('Windows AppUserModelID ayarlanır ve electron-builder appId ile aynıdır (SMTC, V6)', () => {
    setPlatform('win32')
    const a = { setAppUserModelId: vi.fn() }
    applyAppIdentity(a)
    expect(a.setAppUserModelId).toHaveBeenCalledWith(APP_USER_MODEL_ID)
    const yml = readFileSync(join(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8')
    expect(/^appId:\s*(\S+)/m.exec(yml)?.[1]).toBe(APP_USER_MODEL_ID)

    setPlatform('darwin')
    const b = { setAppUserModelId: vi.fn() }
    applyAppIdentity(b)
    expect(b.setAppUserModelId).not.toHaveBeenCalled()
  })

  it('uykudan uyanma dinlenir (2.3)', () => {
    let fire: (() => void) | null = null
    const onResume = vi.fn()
    watchSystemResume(onResume, { on: (_e: 'resume', l: () => void) => (fire = l) })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    fire!()
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('medya tuşu entegrasyonu Chromium özelliklerini açar', () => {
    const commandLine = { appendSwitch: vi.fn() }
    enableMediaKeyIntegration(commandLine)
    expect(commandLine.appendSwitch).toHaveBeenCalledWith(
      'enable-features',
      'HardwareMediaKeyHandling,MediaSessionService'
    )
  })
})
