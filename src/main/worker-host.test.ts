import type { MessagePortMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MainToWorkerSchema, type MainToWorker } from '@shared/ipc-contract'
import { WorkerHost } from './worker-host'

function fakeChild() {
  const handlers: Record<string, (arg?: unknown) => void> = {}
  const child = {
    posted: [] as { message: MainToWorker; transfer?: MessagePortMain[] }[],
    postMessage: vi.fn((message: MainToWorker, transfer?: MessagePortMain[]) => {
      child.posted.push({ message, transfer })
    }),
    on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
      handlers[event] = fn
      return child
    }),
    kill: vi.fn(() => true),
    emit: (event: string, arg?: unknown) => handlers[event]?.(arg)
  }
  return child
}

const port = (name: string) => ({ name }) as unknown as MessagePortMain

function setup(readyTimeoutMs = 1000) {
  const child = fakeChild()
  const getDeveloperToken = vi.fn(async () => ({
    ok: true as const,
    value: { token: 'dev', expiresAt: 1 }
  }))
  const host = new WorkerHost({
    dbPath: 'C:/data/library.db',
    artworkDir: 'C:/data/artwork',
    fork: () => child,
    createChannel: () => ({ port1: port('p1'), port2: port('p2') }),
    getDeveloperToken,
    readyTimeoutMs
  })
  return { host, child, getDeveloperToken }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkerHost', () => {
  it('süreç başlayınca DB yolunu ve mevcut user token’ı gönderir', () => {
    const { host, child } = setup()
    host.setUserToken('tok')
    host.start()
    child.emit('spawn')
    expect(child.posted.map((p) => p.message)).toEqual([
      {
        type: 'init',
        dbPath: 'C:/data/library.db',
        artworkDir: 'C:/data/artwork'
      },
      { type: 'userToken', token: 'tok' }
    ])
  })

  it('worker hazır olunca renderer çerçevesine port verir; hazır olmadan bekler', async () => {
    const { host, child } = setup()
    host.start()
    const frame = { postMessage: vi.fn() }
    const connected = host.connect(frame)
    await Promise.resolve()
    expect(frame.postMessage).not.toHaveBeenCalled()

    child.emit('message', { type: 'ready' })
    await connected
    expect(child.posted.at(-1)).toEqual({ message: { type: 'connect' }, transfer: [port('p1')] })
    expect(frame.postMessage).toHaveBeenCalledWith('worker:port', null, [port('p2')])
  })

  it('developer token isteğini main’deki sağlayıcıdan yanıtlar', async () => {
    const { host, child, getDeveloperToken } = setup()
    host.start()
    child.emit('message', { type: 'getDeveloperToken', requestId: 7 })
    await vi.waitFor(() => expect(getDeveloperToken).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(child.posted.at(-1)!.message).toEqual({
        type: 'developerToken',
        requestId: 7,
        result: { ok: true, value: { token: 'dev', expiresAt: 1 } }
      })
    )
  })

  it('zorla yenileme isteği sağlayıcıya iletilir; bekleme süresi içinde ikincisi önbellekten (A3.1)', async () => {
    const child = fakeChild()
    let now = 1_000_000
    const getDeveloperToken = vi.fn(async (refresh: boolean) => {
      void refresh
      return { ok: true as const, value: { token: 'dev', expiresAt: 1 } }
    })
    const host = new WorkerHost({
      dbPath: 'C:/data/library.db',
      artworkDir: 'C:/data/artwork',
      fork: () => child,
      createChannel: () => ({ port1: port('p1'), port2: port('p2') }),
      getDeveloperToken,
      tokenRefreshCooldownMs: 60_000,
      now: () => now
    })
    host.start()
    const ask = async (requestId: number, refresh?: boolean) => {
      child.emit('message', {
        type: 'getDeveloperToken',
        requestId,
        ...(refresh === undefined ? {} : { refresh })
      })
      await vi.waitFor(() =>
        expect(
          child.posted.some((p) => 'requestId' in p.message && p.message.requestId === requestId)
        ).toBe(true)
      )
    }
    await ask(1)
    await ask(2, true)
    now += 30_000
    await ask(3, true)
    now += 30_000
    await ask(4, true)
    expect(getDeveloperToken.mock.calls.map(([r]) => r)).toEqual([false, true, false, true])
  })

  describe('kapak indirme (A3.2)', () => {
    const lastArtworkRequest = (child: ReturnType<typeof fakeChild>) => {
      const m = child.posted.map((p) => p.message).findLast((x) => x.type === 'fetchArtwork')
      return m?.type === 'fetchArtwork' ? m : undefined
    }

    it('isteği worker’a iletir, yanıtı requestId ile eşler', async () => {
      const { host, child } = setup()
      host.start()
      child.emit('message', { type: 'ready' })
      const pending = host.fetchArtwork('https://is1-ssl.mzstatic.com/a/1x1.jpg')
      await vi.waitFor(() => expect(lastArtworkRequest(child)).toBeDefined())
      const sent = lastArtworkRequest(child)!
      expect(sent.url).toBe('https://is1-ssl.mzstatic.com/a/1x1.jpg')
      child.emit('message', { type: 'artworkFetched', requestId: sent.requestId + 1, result: 'ok' })
      child.emit('message', { type: 'artworkFetched', requestId: sent.requestId, result: 'failed' })
      expect(await pending).toBe('failed')
    })

    it('worker ölürse unavailable; hiç başlamadıysa unavailable', async () => {
      const { host, child } = setup()
      expect(await host.fetchArtwork('u')).toBe('unavailable')
      host.start()
      child.emit('message', { type: 'ready' })
      const pending = host.fetchArtwork('u')
      await vi.waitFor(() => expect(lastArtworkRequest(child)).toBeDefined())
      child.emit('exit', 1)
      expect(await pending).toBe('unavailable')
    })

    it('zaman aşımı → failed', async () => {
      vi.useFakeTimers()
      try {
        const child = fakeChild()
        const host = new WorkerHost({
          dbPath: 'C:/data/library.db',
          artworkDir: 'C:/data/artwork',
          fork: () => child,
          createChannel: () => ({ port1: port('p1'), port2: port('p2') }),
          getDeveloperToken: async () => ({ ok: true, value: { token: 't', expiresAt: 1 } }),
          artworkTimeoutMs: 5_000
        })
        host.start()
        child.emit('message', { type: 'ready' })
        const pending = host.fetchArtwork('u')
        await vi.advanceTimersByTimeAsync(5_000)
        expect(await pending).toBe('failed')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('geçersiz worker mesajı yoksayılır', () => {
    const { host, child, getDeveloperToken } = setup()
    host.start()
    child.emit('message', { type: 'getDeveloperToken', requestId: 'x' })
    child.emit('message', { type: 'eval', code: '1' })
    expect(getDeveloperToken).not.toHaveBeenCalled()
  })

  it.each([
    [
      'fatal',
      (c: ReturnType<typeof fakeChild>) => c.emit('message', { type: 'fatal', message: 'x' })
    ],
    ['exit', (c: ReturnType<typeof fakeChild>) => c.emit('exit', 1)]
  ])('worker %s olursa connect WORKER_UNAVAILABLE ile reddedilir', async (_l, kill) => {
    const { host, child } = setup()
    host.start()
    kill(child)
    await expect(host.connect({ postMessage: vi.fn() })).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE'
    })
  })

  it('worker zamanında hazır olmazsa connect reddedilir', async () => {
    vi.useFakeTimers()
    const { host } = setup(500)
    host.start()
    const connected = host.connect({ postMessage: vi.fn() })
    const assertion = expect(connected).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })

  it('geç gelen hazır bildiriminde bekleyen pencere yine port alır; sonraki connect çalışır (2.7 O2)', async () => {
    vi.useFakeTimers()
    const { host, child } = setup(500)
    host.start()
    const frame = { postMessage: vi.fn() }
    const first = expect(host.connect(frame)).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(500)
    await first
    child.emit('message', { type: 'ready' })
    expect(frame.postMessage).toHaveBeenCalledTimes(1)
    const other = { postMessage: vi.fn() }
    await host.connect(other)
    expect(other.postMessage).toHaveBeenCalledTimes(1)
  })

  it('başlatılmadan connect reddedilir; token ve temizlik mesajları iletilir', async () => {
    const { host, child } = setup()
    await expect(host.connect({ postMessage: vi.fn() })).rejects.toMatchObject({
      code: 'WORKER_UNAVAILABLE'
    })
    host.start()
    host.setUserToken(null)
    void host.clearUserData().catch(() => {})
    expect(child.posted.map((p) => p.message)).toEqual([
      { type: 'userToken', token: null },
      { type: 'clearUserData' }
    ])
  })
})

describe('çıkış silmesi onaylı (2.7 O1)', () => {
  function withRemover() {
    const child = fakeChild()
    const removeDatabaseFiles = vi.fn(async () => {})
    const host = new WorkerHost({
      dbPath: 'C:/data/library.db',
      artworkDir: 'C:/data/artwork',
      fork: () => child,
      createChannel: () => ({ port1: port('p1'), port2: port('p2') }),
      getDeveloperToken: async () => ({ ok: true, value: { token: 't', expiresAt: 1 } }),
      removeDatabaseFiles,
      clearTimeoutMs: 1000
    })
    return { host, child, removeDatabaseFiles }
  }

  it('worker onaylayınca çözülür; dosyalara main dokunmaz', async () => {
    const { host, child, removeDatabaseFiles } = withRemover()
    host.start()
    const done = host.clearUserData()
    child.emit('message', { type: 'userDataCleared', ok: true })
    await expect(done).resolves.toBeUndefined()
    expect(removeDatabaseFiles).not.toHaveBeenCalled()
  })

  it('worker çalışmıyorsa (çökmüş/beklemede) DB dosyalarını main siler', async () => {
    const { host, removeDatabaseFiles } = withRemover()
    await host.clearUserData()
    expect(removeDatabaseFiles).toHaveBeenCalledTimes(1)
  })

  it('worker silme sırasında ölürse dosyaları main siler', async () => {
    const { host, child, removeDatabaseFiles } = withRemover()
    host.start()
    const done = host.clearUserData()
    child.emit('exit', 1)
    await done
    expect(removeDatabaseFiles).toHaveBeenCalledTimes(1)
  })

  it('worker silemediğini bildirirse veya yanıt vermezse hata döner (sessizce yutulmaz)', async () => {
    vi.useFakeTimers()
    const { host, child } = withRemover()
    host.start()
    const failed = host.clearUserData()
    child.emit('message', { type: 'userDataCleared', ok: false })
    await expect(failed).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    const hung = expect(host.clearUserData()).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' })
    await vi.advanceTimersByTimeAsync(1000)
    await hung
  })
})

describe('çıkışta player durumu kaydı (1.8a)', () => {
  const state = { queue: ['1', '2'], position: 1, currentTime: 12 }

  it('worker onaylayınca çözülür', async () => {
    const { host, child } = setup()
    host.start()
    const saved = host.savePlayerState(state)
    const msg = child.posted.at(-1)!.message
    expect(msg).toMatchObject({ type: 'savePlayerState', state })
    child.emit('message', {
      type: 'playerStateSaved',
      requestId: (msg as { requestId: number }).requestId,
      ok: true
    })
    await expect(saved).resolves.toBeUndefined()
  })

  it('worker çökerse bekleyen kayıt çıkışı takmaz; worker yoksa hemen döner', async () => {
    const { host, child } = setup()
    await expect(host.savePlayerState(state)).resolves.toBeUndefined()
    host.start()
    const saved = host.savePlayerState(state)
    child.emit('exit', 1)
    await expect(saved).resolves.toBeUndefined()
  })
})

describe('durdurma', () => {
  it('kasıtlı durdurmada süreç sonu hata olarak loglanmaz', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { host, child } = setup()
    host.start()
    host.stop()
    child.emit('exit', 0)
    expect(child.kill).toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalled()
  })
})

describe('çökme sonrası yeniden başlatma (2.3)', () => {
  function setupMany() {
    const children: ReturnType<typeof fakeChild>[] = []
    const onUnexpectedExit = vi.fn()
    const host = new WorkerHost({
      dbPath: 'C:/data/library.db',
      artworkDir: 'C:/data/artwork',
      fork: () => {
        const c = fakeChild()
        children.push(c)
        return c
      },
      createChannel: () => ({
        port1: { ...port('p1'), close: vi.fn() } as unknown as MessagePortMain,
        port2: port('p2')
      }),
      getDeveloperToken: async () => ({ ok: true as const, value: { token: 'dev', expiresAt: 1 } }),
      onUnexpectedExit
    })
    return { host, children, onUnexpectedExit }
  }

  it('beklenmedik çıkış bildirilir; kasıtlı durdurma bildirilmez', () => {
    const { host, children, onUnexpectedExit } = setupMany()
    host.start()
    children[0]!.emit('exit', 3)
    expect(onUnexpectedExit).toHaveBeenCalledWith(3)
    host.restart()
    host.stop()
    children[1]!.emit('exit', 0)
    expect(onUnexpectedExit).toHaveBeenCalledTimes(1)
  })

  it('yeniden başlayınca daha önce bağlanmış pencereler yeni port alır; kapanmış çerçeve düşer', async () => {
    const { host, children } = setupMany()
    host.start()
    const alive = { postMessage: vi.fn() }
    const closed = { postMessage: vi.fn() }
    children[0]!.emit('message', { type: 'ready' })
    await host.connect(alive)
    await host.connect(closed)
    children[0]!.emit('exit', 1)

    closed.postMessage.mockImplementation(() => {
      throw new Error('Render frame was disposed')
    })
    host.restart()
    expect(children).toHaveLength(2)
    children[1]!.emit('message', { type: 'ready' })
    await new Promise((r) => setTimeout(r, 0))
    expect(alive.postMessage).toHaveBeenCalledTimes(2)
    expect(children[1]!.posted.filter((p) => p.message.type === 'connect')).toHaveLength(1)

    // Kapanmış çerçeve listeden çıktı: sonraki yeniden başlatmada denenmez.
    children[1]!.emit('exit', 1)
    host.restart()
    children[2]!.emit('message', { type: 'ready' })
    await new Promise((r) => setTimeout(r, 0))
    expect(closed.postMessage).toHaveBeenCalledTimes(2)
  })

  it('güvenli mod worker’a bildirilir ve yeniden başlatmada korunur', () => {
    const { host, children } = setupMany()
    host.start()
    host.setSafeMode(true)
    expect(children[0]!.posted.at(-1)!.message).toEqual({ type: 'safeMode', enabled: true })
    children[0]!.emit('exit', 1)
    host.restart()
    children[1]!.emit('spawn')
    expect(children[1]!.posted.map((p) => p.message.type)).toContain('safeMode')
    for (const { message } of children[1]!.posted) {
      expect(MainToWorkerSchema.safeParse(message).success).toBe(true)
    }
  })
})

describe('Hızlı DNS bildirimi (R2)', () => {
  it('worker’ın fastDns mesajı onFastDns’e iletilir', () => {
    const child = fakeChild()
    const onFastDns = vi.fn()
    const host = new WorkerHost({
      dbPath: 'C:/data/library.db',
      artworkDir: 'C:/data/artwork',
      fork: () => child,
      createChannel: () => ({ port1: port('p1'), port2: port('p2') }),
      getDeveloperToken: async () => ({ ok: true, value: { token: 't', expiresAt: 1 } }),
      onFastDns
    })
    host.start()
    child.emit('message', { type: 'fastDns', enabled: false })
    child.emit('message', { type: 'fastDns', enabled: 'evet' })
    expect(onFastDns).toHaveBeenCalledTimes(1)
    expect(onFastDns).toHaveBeenCalledWith(false)
  })
})
