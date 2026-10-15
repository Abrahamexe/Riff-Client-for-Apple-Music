import { afterEach, describe, expect, it, vi } from 'vitest'
import { eventContract, invokeContract } from '@shared/ipc-contract'
import { buildRendererApi, isOwnContent, type IpcRendererLike } from './api'
import { buildWorkerApi, WorkerClient } from './workerClient'

const worker = buildWorkerApi(new WorkerClient())

function fakeIpc() {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()
  const ipc = {
    invoke: vi.fn(async () => ({ ok: true, value: null })),
    on: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(fn)
    }),
    removeListener: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => void) => {
      listeners.get(channel)?.delete(fn)
    })
  } satisfies IpcRendererLike
  const emit = (channel: string, payload: unknown): void =>
    listeners.get(channel)?.forEach((fn) => fn({ sender: 'ipcRenderer' }, payload))
  return { ipc, emit, count: (channel: string) => listeners.get(channel)?.size ?? 0 }
}

afterEach(() => vi.restoreAllMocks())

describe('buildRendererApi', () => {
  it('yalnızca sözleşmedeki fonksiyonları açar; genel invoke/send/on yok', () => {
    const api = buildRendererApi(fakeIpc().ipc, worker)
    expect(Object.keys(api).sort()).toEqual(
      [...Object.keys(invokeContract), ...Object.keys(eventContract), 'worker'].sort()
    )
    for (const generic of ['invoke', 'send', 'on', 'sendSync', 'postMessage']) {
      expect(api).not.toHaveProperty(generic)
    }
    expect(Object.isFrozen(api)).toBe(true)
  })

  it('her fonksiyon kendi sabit kanalını çağırır', async () => {
    const { ipc } = fakeIpc()
    const api = buildRendererApi(ipc, worker)
    await api.sendPlayerCommand({ type: 'seek', seconds: 3 })
    await api.getDeveloperToken()
    expect(ipc.invoke).toHaveBeenNthCalledWith(1, 'player:command', { type: 'seek', seconds: 3 })
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, 'token:getDeveloperToken')
  })

  it('bildirim: event nesnesi iletilmez, yük doğrulanır, abonelikten çıkılabilir', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ipc, emit, count } = fakeIpc()
    const api = buildRendererApi(ipc, worker)
    const listener = vi.fn()
    const off = api.onCdmStatus(listener)

    emit('cdm:status', { state: 'ready' })
    emit('cdm:status', { state: 'hacked', payload: '<img onerror=alert(1)>' })
    expect(listener.mock.calls).toEqual([[{ state: 'ready' }]])

    off()
    expect(count('cdm:status')).toBe(0)
  })
})

describe('isOwnContent', () => {
  it('app://renderer içeriğine API açılır', () => {
    expect(isOwnContent('app://renderer/index.html', false)).toBe(true)
  })

  it('dev localhost yalnızca izin verildiğinde', () => {
    expect(isOwnContent('http://localhost:5173/', true)).toBe(true)
    expect(isOwnContent('http://localhost:5173/', false)).toBe(false)
  })

  it.each([
    'https://authorize.music.apple.com/woa',
    'app://evil/index.html',
    'http://localhost.evil.com/',
    'https://localhost/',
    'file:///C:/x.html',
    'geçersiz'
  ])('reddeder: %s', (href) => expect(isOwnContent(href, true)).toBe(false))
})
