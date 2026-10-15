import { afterEach, describe, expect, it, vi } from 'vitest'
import { installProcessErrorHandlers, installWindowErrorHandlers } from './global'

afterEach(() => vi.restoreAllMocks())

describe('global hata yakalayıcılar (2.3)', () => {
  it('process: yakalanmamış hata ve promise reddi katalog koduyla loglanır', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers: Record<string, (e: unknown) => void> = {}
    installProcessErrorHandlers('worker', {
      on: (event: string, fn: (e: never) => void) => (handlers[event] = fn as (e: unknown) => void)
    })
    handlers.uncaughtException!(new Error('patladı'))
    handlers.unhandledRejection!('sebep')
    const logged = error.mock.calls.map((c) => String(c[0]))
    expect(logged[0]).toMatch(/\[worker\] APP_003 INTERNAL: .*uncaughtException/)
    expect(logged[1]).toMatch(/\[worker\] APP_003 INTERNAL: .*unhandledRejection/)
  })

  it('window: error ve unhandledrejection olayları loglanır', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers: Record<string, (e: unknown) => void> = {}
    installWindowErrorHandlers('renderer', {
      addEventListener: (type: string, fn: (e: never) => void) => {
        handlers[type] = fn as (e: unknown) => void
      }
    })
    handlers.error!({ error: new Error('x') })
    handlers.unhandledrejection!({ reason: new Error('y') })
    expect(error).toHaveBeenCalledTimes(2)
    expect(String(error.mock.calls[0]![0])).toContain('[renderer] APP_003')
  })
})
