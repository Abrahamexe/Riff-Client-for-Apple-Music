import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '@shared/errors'

// PLAN_v5 P6: uygulama kabuğu. Çekirdek modüller sahte; yalnızca açılış SIRASI, bağlantılar ve
// olaylar sınanır (her modülün kendi testi var).

const calls: string[] = []
const guard: { handlers: Record<string, (e?: unknown) => Promise<void>> } = { handlers: {} }

vi.mock('@core/musickit/loader', () => ({
  configureMusicKit: vi.fn(async () => void calls.push('configure')),
  getMusicKit: vi.fn(() => ({ storefrontId: 'tr' })),
  musicKitConfiguredAt: vi.fn(() => 1),
  reconfigureMusicKit: vi.fn(async () => void calls.push('reconfigure'))
}))
vi.mock('@core/musickit/auth', () => ({
  restoreSession: vi.fn(async () => {
    calls.push('restoreSession')
    return { restored: true, authorized: true }
  }),
  syncStorefront: vi.fn(async () => void calls.push('storefront')),
  signIn: vi.fn(async () => void calls.push('signIn')),
  signOut: vi.fn(async () => void calls.push('signOut'))
}))
vi.mock('@core/musickit/guard', () => ({
  setGuardHandlers: vi.fn((h: Record<string, (e?: unknown) => Promise<void>>) => {
    guard.handlers = h
  })
}))
vi.mock('@core/data/playerState', () => ({
  persistPlayerState: vi.fn(() => () => {}),
  restorePlayerState: vi.fn(async () => {
    calls.push('restoreQueue')
    return true
  })
}))
vi.mock('@core/settings/settings', () => ({
  SettingsClient: class {
    current = null
    onChange = () => () => {}
    load = async () => void calls.push('settings')
  },
  applyPlaybackSettings: vi.fn()
}))
vi.mock('@core/audio/equalizer', () => ({
  Equalizer: class {},
  bindEqualizer: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() }))
}))
vi.mock('@core/musickit/mediaSession', () => ({ bindMediaSession: vi.fn() }))
vi.mock('@core/musickit/player', () => ({
  Player: class {
    constructor() {
      calls.push('player')
    }
    holdQueueUntil(task: Promise<unknown>) {
      calls.push('hold')
      void task
    }
  }
}))
vi.mock('@core/player/hubPublisher', () => ({ connectPlayerToHub: vi.fn() }))
vi.mock('@core/background/background', () => ({
  BackgroundClient: class {},
  connectBackgroundPrefetch: vi.fn()
}))
vi.mock('@core/background/lyrics', () => ({
  connectLyricsPrefetch: vi.fn(),
  lyricsClient: vi.fn()
}))
vi.mock('@core/data/library', () => ({
  LibraryClient: class {
    onWriteFailed = () => () => {}
    flushPendingWrites = async () => {}
    sync = async () => ({ changed: false })
  }
}))
vi.mock('@core/system', () => ({ onReconnect: vi.fn(), refreshAfterReconnect: vi.fn() }))
vi.mock('@core/cdm', () => ({
  CdmGate: class {
    status = { state: 'ready' }
    on = () => () => {}
    start = async () => {}
    waitUntilReady = async () => {}
  }
}))
const clearToken = vi.fn(async () => {})
vi.mock('../tokenStore', () => ({
  ipcAuthorize: vi.fn(),
  ipcUserTokenStore: { load: vi.fn(), clear: () => clearToken() }
}))
vi.mock('../cdmSource', () => ({ ipcCdmSource: {} }))
vi.mock('../playerHub', () => ({ ipcHubPort: {} }))
vi.mock('../ipc', () => ({ unwrap: async <T>(p: Promise<{ value: T }>) => (await p).value }))

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('window', {
    api: {
      getDeveloperToken: async () => ({ ok: true, value: { token: 'dev', expiresAt: 1 } }),
      onSystemResume: () => () => {}
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

const { App } = await import('./bootstrap')

describe('App (PLAN_v5 P6)', () => {
  it('açılış sırası: MusicKit → ayarlar → Player → oturum + son kuyruk; olaylar yayınlanır', async () => {
    const app = new App({ name: 'Riff Client', build: '0' })
    const events: string[] = []
    app.on('musicKitReady', ({ storefront }) => events.push(`ready:${storefront}`))
    app.on('playerReady', () => events.push('player'))
    app.on('session', (s) => events.push(`session:${s.authorized}`))
    app.on('queueRestored', () => events.push('queue'))
    await app.start()
    expect(calls).toEqual([
      'configure',
      'settings',
      'player',
      'restoreSession',
      'storefront',
      'hold',
      'restoreQueue'
    ])
    // R2: oturum kuyruktan önce yayınlanır (arayüz kuyruğu beklemez).
    expect(events).toEqual(['ready:tr', 'player', 'session:true', 'queue'])
    expect(app.hasPlayer).toBe(true)
  })

  it('MusicKit başlatılamazsa fırlatmaz, error olayı verir; Player oluşturulmaz', async () => {
    const loader = await import('@core/musickit/loader')
    vi.mocked(loader.configureMusicKit).mockRejectedValueOnce(new CoreError('OFFLINE', 'ağ yok'))
    const app = new App({ name: 'Riff Client', build: '0' })
    const errors: string[] = []
    app.on('error', ({ error, context }) => errors.push(`${error.code}:${context}`))
    await app.start()
    expect(errors).toEqual(['OFFLINE:MusicKit başlatılamadı'])
    expect(app.hasPlayer).toBe(false)
  })

  it('401 korumasında kayıtlı token silinir ve unauthorized olayı yayınlanır', async () => {
    const app = new App({ name: 'Riff Client', build: '0' })
    const seen: string[] = []
    app.on('unauthorized', (e) => seen.push(e.code))
    await app.start()
    await guard.handlers.onUnauthorized!(new CoreError('UNAUTHORIZED', '401'))
    expect(clearToken).toHaveBeenCalled()
    expect(seen).toEqual(['UNAUTHORIZED'])
    await guard.handlers.onDeveloperTokenExpired!()
    expect(calls).toContain('reconfigure')
  })

  it('giriş / çıkış çekirdeğe iletilir; B8: oturum durumu ve session olayı', async () => {
    const app = new App({ name: 'Riff Client', build: '0' })
    const sessions: boolean[] = []
    app.on('session', (s) => sessions.push(s.authorized))
    expect(app.signedIn).toBeNull()
    await app.signIn()
    expect(app.signedIn).toBe(true)
    await app.signOut()
    expect(app.signedIn).toBe(false)
    expect(calls).toEqual(['signIn', 'signOut'])
    expect(sessions).toEqual([true, false])
  })

  it('B8: açılışta geri yüklenen oturum ve 401 sonrası durum', async () => {
    const app = new App({ name: 'Riff Client', build: '0' })
    await app.start()
    expect(app.signedIn).toBe(true)
    await guard.handlers.onUnauthorized!(new CoreError('UNAUTHORIZED', '401'))
    expect(app.signedIn).toBe(false)
  })

  it('B8: Aboneliği Yönet yalnızca anahtarla gider', async () => {
    const open = vi.fn(async () => ({ ok: true, value: null }))
    vi.stubGlobal('window', { api: { openExternalLink: open } })
    const app = new App({ name: 'Riff Client', build: '0' })
    await app.openExternal('manageSubscriptions')
    expect(open).toHaveBeenCalledWith('manageSubscriptions')
  })
})
