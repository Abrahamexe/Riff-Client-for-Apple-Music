import { afterEach, describe, expect, it, vi } from 'vitest'
import { workerContract, workerEventContract } from '@shared/ipc-contract'
import { buildWorkerApi, WorkerClient, type PortLike } from './workerClient'

function fakePort() {
  let listener: ((event: { data: unknown }) => void) | null = null
  let onClose: (() => void) | null = null
  const port = {
    sent: [] as { id: number; method: string; params: unknown }[],
    postMessage: vi.fn((m: unknown) => void port.sent.push(m as (typeof port.sent)[number])),
    addEventListener: vi.fn((type: string, fn: (event: { data: unknown }) => void) => {
      if (type === 'close') onClose = fn as () => void
      else listener = fn
    }),
    start: vi.fn(),
    close: vi.fn(),
    receive: (data: unknown) => listener?.({ data }),
    /** Karşı uç kapandı (worker çöktü). */
    hangUp: () => onClose?.()
  }
  return port as typeof port & PortLike
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkerClient', () => {
  it('worker çökerse (port kapanır) bekleyen istekler hemen WORKER_UNAVAILABLE; yeniler yeni portu bekler (2.3)', async () => {
    const client = new WorkerClient(60_000)
    const old = fakePort()
    client.attach(old)
    const pending = client.request('getPlaylists', {})
    old.hangUp()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } })

    const queued = client.request('getPlaylists', {})
    expect(old.sent).toHaveLength(1) // kapanmış porta gönderilmedi
    const fresh = fakePort()
    client.attach(fresh)
    expect(fresh.sent.map((m) => m.method)).toEqual(['getPlaylists'])
    fresh.receive({
      id: fresh.sent[0]!.id,
      result: { ok: true, value: { items: [], syncedAt: 1 } }
    })
    expect(await queued).toEqual({ ok: true, value: { items: [], syncedAt: 1 } })

    // Eski portun gecikmeli kapanması yeni bağlantıyı bozmaz.
    old.hangUp()
    const next = client.request('getPlaylists', {})
    expect(fresh.sent).toHaveLength(2)
    fresh.receive({
      id: fresh.sent[1]!.id,
      result: { ok: true, value: { items: [], syncedAt: 2 } }
    })
    expect(await next).toMatchObject({ ok: true })
  })

  it('port gelmeden yapılan istekler kuyrukta bekler, port gelince gönderilir', async () => {
    const client = new WorkerClient()
    const pending = client.request('getPlaylists', {})
    const port = fakePort()
    client.attach(port)
    expect(port.start).toHaveBeenCalled()
    expect(port.sent).toEqual([{ id: 1, method: 'getPlaylists', params: {} }])
    port.receive({ id: 1, result: { ok: true, value: { items: [], syncedAt: null } } })
    expect(await pending).toEqual({ ok: true, value: { items: [], syncedAt: null } })
  })

  it('yanıtlar id ile eşlenir; bilinmeyen id yoksayılır', async () => {
    const client = new WorkerClient()
    const port = fakePort()
    client.attach(port)
    const a = client.request('probeLibraryAccess', {})
    const b = client.request('loadPlayerState', {})
    port.receive({ id: 99, result: { ok: true, value: 'x' } })
    port.receive({ id: 2, result: { ok: true, value: null } })
    port.receive({ id: 1, result: { ok: true, value: 3 } })
    expect(await a).toEqual({ ok: true, value: 3 })
    expect(await b).toEqual({ ok: true, value: null })
  })

  it('worker yanıt vermezse WORKER_UNAVAILABLE ile sonuçlanır (reject etmez)', async () => {
    vi.useFakeTimers()
    const client = new WorkerClient(1000)
    const pending = client.request('getPlaylists', {})
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } })
  })

  it('zaman aşımına uğrayan istek port gelince bayat olarak gönderilmez; kuyruk sınırlı (2.7 D4)', async () => {
    vi.useFakeTimers()
    const client = new WorkerClient(1000)
    const stale = client.request('getPlaylists', {})
    await vi.advanceTimersByTimeAsync(1000)
    await stale
    const flood = Array.from({ length: 501 }, () => client.request('loadPlayerState', {}))
    expect(await flood[500]).toMatchObject({ ok: false, error: { code: 'WORKER_UNAVAILABLE' } })
    const port = fakePort()
    client.attach(port)
    expect(port.sent.some((m) => m.method === 'getPlaylists')).toBe(false)
    expect(port.sent).toHaveLength(500)
  })

  it('bildirimler şemayla doğrulanır; geçersiz olan dinleyiciye ulaşmaz', () => {
    const client = new WorkerClient()
    const port = fakePort()
    client.attach(port)
    const listener = vi.fn()
    const off = client.on('library:changed', listener)
    port.receive({ event: 'library:changed', payload: { scope: 'playlists' } })
    port.receive({ event: 'library:changed', payload: { scope: 'hepsi', x: '<script>' } })
    port.receive({ event: 'bilinmeyen', payload: {} })
    expect(listener.mock.calls).toEqual([[{ scope: 'playlists' }]])
    off()
    port.receive({ event: 'library:changed', payload: { scope: 'playlists' } })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('yeni port eskisinin yerini alır ve eskisini kapatır', () => {
    const client = new WorkerClient()
    const first = fakePort()
    client.attach(first)
    client.attach(fakePort())
    expect(first.close).toHaveBeenCalled()
  })
})

describe('buildWorkerApi', () => {
  it('yalnızca sözleşmedeki yöntem ve bildirimleri açar; genel request yok', async () => {
    const client = new WorkerClient()
    const api = buildWorkerApi(client)
    expect(Object.keys(api).sort()).toEqual(
      [...Object.keys(workerContract), ...Object.keys(workerEventContract)].sort()
    )
    expect(api).not.toHaveProperty('request')
    expect(Object.isFrozen(api)).toBe(true)

    const port = fakePort()
    client.attach(port)
    void api.searchLibrary({ term: 'x' })
    expect(port.sent[0]).toMatchObject({ method: 'searchLibrary', params: { term: 'x' } })
  })
})
