/* eslint-disable @typescript-eslint/only-throw-error -- MusicKit hataları düz nesne ({ errorCode, status }) olarak fırlatılır; testler bunu taklit eder. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '../errors'
import { guarded, setGuardHandlers } from './guard'

const noSleep = { sleep: async () => {}, random: () => 0 }

beforeEach(() => setGuardHandlers({ retry: noSleep }))
afterEach(() => setGuardHandlers({}))

describe('guarded', () => {
  it('başarılı çağrının değerini döner', async () => {
    expect(await guarded(async () => 42)).toBe(42)
  })

  it('401 → onUnauthorized çağrılır, UNAUTHORIZED fırlatılır, yeniden denenmez', async () => {
    const onUnauthorized = vi.fn()
    setGuardHandlers({ onUnauthorized, retry: noSleep })
    const fn = vi.fn(async () => {
      throw { data: { status: 401 } }
    })
    await expect(guarded(fn)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('403 de user token geçersiz sayılır', async () => {
    const onUnauthorized = vi.fn()
    setGuardHandlers({ onUnauthorized, retry: noSleep })
    await expect(
      guarded(async () => {
        throw { status: 403 }
      })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it('2.3: 401 önce developer token tazelenerek bir kez denenir; geçerse çıkış YAPILMAZ', async () => {
    const onUnauthorized = vi.fn()
    const onDeveloperTokenExpired = vi.fn(async () => {})
    setGuardHandlers({ onUnauthorized, onDeveloperTokenExpired, retry: noSleep })
    let calls = 0
    const result = await guarded(async () => {
      if (calls++ === 0) throw { status: 401 }
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(onDeveloperTokenExpired).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('2.3: tazelemeden sonra da 401 → user token geçersiz (bir kez), döngü yok', async () => {
    const onUnauthorized = vi.fn()
    const onDeveloperTokenExpired = vi.fn(async () => {})
    setGuardHandlers({ onUnauthorized, onDeveloperTokenExpired, retry: noSleep })
    const fn = vi.fn(async () => {
      throw { status: 401 }
    })
    await expect(guarded(fn)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(onDeveloperTokenExpired).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('429 → geri çekilerek tekrar dener ve başarır', async () => {
    let calls = 0
    const result = await guarded(async () => {
      if (++calls < 3) throw { data: { status: 429 } }
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('ağ yokken tekrar dener; kalıcıysa OFFLINE fırlatır', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(guarded(fn)).rejects.toMatchObject({ code: 'OFFLINE' })
    expect(fn).toHaveBeenCalledTimes(4) // 1 + 3 yeniden deneme
  })

  it('developer token dolmuşsa yeniler ve bir kez daha dener', async () => {
    const onDeveloperTokenExpired = vi.fn(async () => {})
    setGuardHandlers({ onDeveloperTokenExpired, retry: noSleep })
    let calls = 0
    const result = await guarded(async () => {
      if (++calls === 1) throw { errorCode: 'TOKEN_EXPIRED' }
      return 'yenilendi'
    })
    expect(result).toBe('yenilendi')
    expect(onDeveloperTokenExpired).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('yenilemeden sonra da başarısızsa döngüye girmez', async () => {
    const onDeveloperTokenExpired = vi.fn(async () => {})
    setGuardHandlers({ onDeveloperTokenExpired, retry: noSleep })
    const fn = vi.fn(async () => {
      throw { errorCode: 'TOKEN_EXPIRED' }
    })
    await expect(guarded(fn)).rejects.toMatchObject({ code: 'DEVELOPER_TOKEN_EXPIRED' })
    expect(onDeveloperTokenExpired).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('senkron fırlatılan hatayı da CoreError yapar', async () => {
    const fn = (): Promise<never> => {
      throw new Error('senkron')
    }
    const err = await guarded(fn, 'mesaj').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CoreError)
    expect((err as CoreError).code).toBe('API_REQUEST_FAILED')
  })
})
