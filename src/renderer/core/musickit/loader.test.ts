import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMusicKit, MUSICKIT_RETRY_DELAYS_MS } from './loader'

/** Sahte DOM: her appendChild bir "ağ denemesi"dir; `outcomes` sırayla başarısız/başarılı olur. */
function fakeDom(outcomes: ('fail' | 'ok')[]) {
  const listeners = new Set<() => void>()
  const scripts: { removed: boolean }[] = []
  const win: { MusicKit?: unknown } = {}
  const document = {
    createElement: () => {
      const el = {
        src: '',
        async: false,
        removed: false,
        onerror: null as null | (() => void),
        remove: () => void (el.removed = true)
      }
      scripts.push(el)
      return el
    },
    head: {
      appendChild: (el: { onerror: null | (() => void) }) => {
        const outcome = outcomes.shift() ?? 'fail'
        queueMicrotask(() => {
          if (outcome === 'fail') el.onerror?.()
          else {
            win.MusicKit = { getInstance: () => undefined }
            for (const l of [...listeners]) l()
          }
        })
      }
    },
    addEventListener: (_t: string, l: () => void) => listeners.add(l),
    removeEventListener: (_t: string, l: () => void) => listeners.delete(l)
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', document)
  return { scripts, win }
}

afterEach(() => vi.unstubAllGlobals())

describe('loadMusicKit (2.3: yeniden deneme)', () => {
  it('ağ hatasında artan beklemeyle yeniden dener; başarısız etiketler kaldırılır', async () => {
    const { scripts } = fakeDom(['fail', 'fail', 'ok'])
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    await expect(loadMusicKit({ sleep })).resolves.toBeDefined()
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...MUSICKIT_RETRY_DELAYS_MS])
    expect(scripts.map((s) => s.removed)).toEqual([true, true, false])
  })

  it('denemeler tükenirse MK_001 fırlatır; sonraki çağrı baştan dener', async () => {
    fakeDom(['fail', 'fail', 'fail', 'ok'])
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    await expect(loadMusicKit({ sleep })).rejects.toMatchObject({ code: 'MUSICKIT_LOAD_FAILED' })
    await expect(loadMusicKit({ sleep })).resolves.toBeDefined()
  })

  it('eşzamanlı çağrılar tek yüklemeyi paylaşır', async () => {
    const { scripts } = fakeDom(['ok'])
    const [a, b] = await Promise.all([loadMusicKit(), loadMusicKit()])
    expect(a).toBe(b)
    expect(scripts).toHaveLength(1)
  })
})

describe('developer token önden yenileme (2.3)', () => {
  it('jwtExpiry: exp okunur; bozuk token null', async () => {
    const { jwtExpiry } = await import('./loader')
    const payload = btoa(JSON.stringify({ iss: 'T', exp: 1_800_000_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(jwtExpiry(`eyJhbGciOiJFUzI1NiJ9.${payload}.imza`)).toBe(1_800_000_000)
    expect(jwtExpiry('bozuk')).toBeNull()
    expect(jwtExpiry('a.@@@.c')).toBeNull()
  })

  it('configure sonrası token dolmadan 10 dk önce yeniden yapılandırılır; kullanıcı token’ı ve içerik kısıtlaması korunur (2.7 O3)', async () => {
    vi.useFakeTimers()
    const { configureMusicKit, TOKEN_REFRESH_BEFORE_MS } = await import('./loader')
    const now = Date.now()
    const tokenWithExp = (exp: number) => `h.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.s`
    type Fake = { musicUserToken?: string; restrictedEnabled?: boolean }
    let instance: Fake = {}
    const configure = vi.fn(async () => (instance = {}))
    const MusicKit = { configure, getInstance: () => instance }
    vi.stubGlobal('window', { MusicKit })
    const getToken = vi.fn(async () => tokenWithExp(Math.floor(now / 1000) + 3600))
    await configureMusicKit(getToken, { name: 'T', build: '1' })
    instance.musicUserToken = 'kullanici'
    instance.restrictedEnabled = false
    await vi.advanceTimersByTimeAsync(3600_000 - TOKEN_REFRESH_BEFORE_MS - 1_000)
    expect(configure).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(configure).toHaveBeenCalledTimes(2)
    expect(instance.musicUserToken).toBe('kullanici')
    expect(instance.restrictedEnabled).toBe(false)
    vi.useRealTimers()
  })
})
