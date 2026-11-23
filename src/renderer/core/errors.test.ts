import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoreError, isUnauthorized, toCoreError, userMessage } from './errors'
import { i18n } from './i18n'
import { backoffDelay, withRetry } from './retry'

afterEach(() => vi.unstubAllGlobals())

describe('toCoreError', () => {
  it('CoreError aynen döner', () => {
    const e = new CoreError('UNAUTHORIZED', 'x')
    expect(toCoreError(e)).toBe(e)
  })

  it.each([
    [{ errorCode: 'UNAUTHORIZED_ERROR' }, 'UNAUTHORIZED'],
    [{ errorCode: 'ACCESS_DENIED' }, 'UNAUTHORIZED'],
    [{ errorCode: 'QUOTA_EXCEEDED' }, 'RATE_LIMITED'],
    [{ errorCode: 'NETWORK_ERROR' }, 'OFFLINE'],
    [{ errorCode: 'TOKEN_EXPIRED' }, 'DEVELOPER_TOKEN_EXPIRED'],
    [{ errorCode: 'SERVER_ERROR' }, 'SERVER_ERROR']
  ])('MKError %j → %s', (err, code) => {
    expect(toCoreError(err).code).toBe(code)
  })

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR']
  ])('HTTP %i → %s (data.status ve status)', (status, code) => {
    expect(toCoreError({ data: { status } }).code).toBe(code)
    expect(toCoreError({ status }).code).toBe(code)
  })

  it('bilinmeyen hata fallback koduna düşer, HTTP 404 yeniden denenmez', () => {
    const e = toCoreError({ status: 404 }, 'API_REQUEST_FAILED')
    expect(e.code).toBe('API_REQUEST_FAILED')
    expect(e.retryable).toBe(false)
  })

  it('fetch ağ hatası → OFFLINE', () => {
    expect(toCoreError(new TypeError('Failed to fetch')).code).toBe('OFFLINE')
  })

  it('navigator.onLine=false → OFFLINE', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(toCoreError(new Error('boom')).code).toBe('OFFLINE')
  })

  it('orijinal hatayı cause olarak saklar', () => {
    const orig = new Error('orijinal')
    expect(toCoreError(orig).cause).toBe(orig)
  })
})

describe('CoreError yardımcıları', () => {
  it('retryable yalnızca 429, ağ ve 5xx için', () => {
    expect(new CoreError('RATE_LIMITED', '').retryable).toBe(true)
    expect(new CoreError('OFFLINE', '').retryable).toBe(true)
    expect(new CoreError('SERVER_ERROR', '').retryable).toBe(true)
    expect(new CoreError('UNAUTHORIZED', '').retryable).toBe(false)
    expect(new CoreError('PLAYBACK_FAILED', '').retryable).toBe(false)
  })

  it('isUnauthorized ve userMessage', () => {
    expect(isUnauthorized(new CoreError('UNAUTHORIZED', ''))).toBe(true)
    expect(isUnauthorized(new Error('x'))).toBe(false)
    i18n.setPreference('tr')
    expect(userMessage(new CoreError('OFFLINE', 'teknik'), i18n)).toMatch(/nternet bağlantısı yok/)
    // Teknik mesaj kullanıcıya gösterilmez; katalogdaki mesaj kullanılır.
    expect(userMessage(new CoreError('PLAYBACK_FAILED', 'kendi mesajı'), i18n)).toBe(
      'Şarkı çalınamadı.'
    )
    i18n.setPreference('system')
  })
})

describe('backoffDelay / withRetry', () => {
  const rate = new CoreError('RATE_LIMITED', 'x')

  it('üstel artar ve üst sınırla kırpılır (jitter sabit)', () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 }
    expect([1, 2, 3, 4, 5].map((a) => backoffDelay(a, rate, opts))).toEqual([
      100, 200, 400, 800, 1000
    ])
  })

  it('jitter alt sınırı üstel değerin yarısıdır', () => {
    expect(backoffDelay(3, rate, { baseDelayMs: 100, random: () => 0 })).toBe(200)
  })

  it('Retry-After varsa o süre kullanılır (üst sınırla)', () => {
    const e = new CoreError('RATE_LIMITED', 'x', { retryAfterMs: 3000 })
    expect(backoffDelay(1, e, { maxDelayMs: 10_000 })).toBe(3000)
    expect(backoffDelay(1, e, { maxDelayMs: 2000 })).toBe(2000)
  })

  it('geçici hatada yeniden dener ve sonunda başarır', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new CoreError('OFFLINE', 'ağ yok')
        return 'tamam'
      },
      { sleep, random: () => 0 }
    )
    expect(result).toBe('tamam')
    expect(calls).toBe(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('retries sınırını aşınca son hatayı fırlatır', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new CoreError('SERVER_ERROR', 'x')
        },
        { retries: 2, sleep: async () => {} }
      )
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    expect(calls).toBe(3)
  })

  it('kalıcı hatalarda (401) hiç tekrar denemez', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new CoreError('UNAUTHORIZED', 'x')
        },
        { sleep: async () => {} }
      )
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(calls).toBe(1)
  })

  it('onRetry bilgi verir', async () => {
    const onRetry = vi.fn()
    let calls = 0
    await withRetry(
      async () => {
        if (++calls === 1) throw rate
      },
      { sleep: async () => {}, onRetry, random: () => 0 }
    )
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, error: rate }))
  })
})
