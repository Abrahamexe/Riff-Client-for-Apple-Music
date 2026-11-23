import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CdmStatus } from '@shared/types'
import { CdmGate, type CdmSource } from './cdm'
import { CoreError } from './errors'

function fakeSource(initial: CdmStatus) {
  const listeners = new Set<(s: CdmStatus) => void>()
  const source: CdmSource = {
    getStatus: vi.fn(async () => initial),
    onStatus: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
  const push = (s: CdmStatus): void => listeners.forEach((fn) => fn(s))
  return { source, push, listenerCount: () => listeners.size }
}

afterEach(() => vi.useRealTimers())

describe('CdmGate', () => {
  it('CDM hazırsa hemen döner', async () => {
    const { source } = fakeSource({ state: 'ready' })
    const gate = new CdmGate(source)
    await gate.start()
    await expect(gate.waitUntilReady()).resolves.toBeUndefined()
  })

  it('pending iken bekler, ready bildirimi gelince devam eder', async () => {
    const { source, push } = fakeSource({ state: 'pending' })
    const gate = new CdmGate(source)
    await gate.start()
    let done = false
    const wait = gate.waitUntilReady().then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    push({ state: 'ready' })
    await wait
    expect(done).toBe(true)
    expect(gate.status).toEqual({ state: 'ready' })
  })

  it('CDM kurulamazsa DRM_UNAVAILABLE fırlatır (bekleyenler ve sonraki çağrılar)', async () => {
    const { source, push } = fakeSource({ state: 'pending' })
    const gate = new CdmGate(source)
    await gate.start()
    const wait = gate.waitUntilReady()
    push({ state: 'error', message: 'indirme başarısız' })
    await expect(wait).rejects.toMatchObject({ code: 'DRM_UNAVAILABLE' })
    await expect(gate.waitUntilReady()).rejects.toBeInstanceOf(CoreError)
  })

  it('süre dolarsa DRM_NOT_READY fırlatır ve dinleyiciyi temizler', async () => {
    vi.useFakeTimers()
    const { source } = fakeSource({ state: 'pending' })
    const gate = new CdmGate(source, { timeoutMs: 1000 })
    await gate.start()
    const wait = gate.waitUntilReady()
    const assertion = expect(wait).rejects.toMatchObject({ code: 'DRM_NOT_READY' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('ilk sorgudan önce gelen push bildirimi eski sorgu sonucuyla ezilmez', async () => {
    let resolveQuery!: (s: CdmStatus) => void
    const listeners = new Set<(s: CdmStatus) => void>()
    const source: CdmSource = {
      getStatus: () => new Promise((r) => (resolveQuery = r)),
      onStatus: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      }
    }
    const gate = new CdmGate(source)
    const started = gate.start()
    listeners.forEach((fn) => fn({ state: 'ready' }))
    resolveQuery({ state: 'pending' })
    await started
    expect(gate.status).toEqual({ state: 'ready' })
  })

  it('stop aboneliği kaldırır', async () => {
    const { source, listenerCount } = fakeSource({ state: 'ready' })
    const gate = new CdmGate(source)
    await gate.start()
    expect(listenerCount()).toBe(1)
    gate.stop()
    expect(listenerCount()).toBe(0)
  })
})
