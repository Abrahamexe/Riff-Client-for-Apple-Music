import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18n } from '../i18n'
import { en } from '../i18n/en'
import { tr } from '../i18n/tr'
import {
  CATEGORY_PREFIX,
  CoreError,
  ERROR_CATALOG,
  ERROR_CODES,
  fromWireError,
  isErrorCode,
  logError,
  userMessage,
  userMessageWithId
} from './index'

afterEach(() => vi.restoreAllMocks())

describe('hata kataloğu', () => {
  it('kimlikler benzersiz ve KATEGORİ_NNN biçiminde', () => {
    const ids = ERROR_CODES.map((c) => ERROR_CATALOG[c].id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const code of ERROR_CODES) {
      const { id, category } = ERROR_CATALOG[code]
      expect(id, code).toMatch(new RegExp(`^${CATEGORY_PREFIX[category]}_\\d{3}$`))
    }
  })

  it('her kodun kullanıcı mesajı iki dilde de var', () => {
    for (const code of ERROR_CODES) {
      const key = ERROR_CATALOG[code].messageKey
      expect(tr[key], code).toBeTruthy()
      expect(en[key], code).toBeTruthy()
    }
  })

  it('yalnızca geçici hatalar yeniden denenebilir', () => {
    const retryable = ERROR_CODES.filter((c) => ERROR_CATALOG[c].retryable).sort()
    expect(retryable).toEqual([
      'BG_RATE_LIMITED',
      'BG_SOURCE_UNAVAILABLE',
      'OFFLINE',
      'RATE_LIMITED',
      'SERVER_ERROR'
    ])
  })

  it('isErrorCode', () => {
    expect(isErrorCode('UNAUTHORIZED')).toBe(true)
    expect(isErrorCode('toString')).toBe(false)
    expect(isErrorCode(42)).toBe(false)
  })
})

describe('CoreError ↔ katalog', () => {
  it('kimlik, seviye ve yeniden deneme katalogdan gelir', () => {
    const e = new CoreError('OFFLINE', 'teknik')
    expect(e.id).toBe('NET_001')
    expect(e.logLevel).toBe('warn')
    expect(e.retryable).toBe(true)
  })

  it('süreç sınırında kod ve parametreler korunur', () => {
    const e = new CoreError('TOKEN_ENV_MISSING', 'teknik', { params: { fields: 'APPLE_KEY_ID' } })
    const back = fromWireError(e.toWire())
    expect(back.code).toBe('TOKEN_ENV_MISSING')
    expect(back.params).toEqual({ fields: 'APPLE_KEY_ID' })
    expect(fromWireError({ code: 'INVALID_PAYLOAD', message: 'x' }).id).toBe('IPC_003')
  })

  it('katalogda olmayan kod UNKNOWN olur', () => {
    expect(fromWireError({ code: 'YOK_BOYLE', message: 'x' }).code).toBe('UNKNOWN')
  })
})

describe('kullanıcı mesajı', () => {
  it('dil değişince mesaj değişir; teknik mesaj kullanıcıya gitmez', () => {
    const i18n = new I18n(['tr-TR'])
    const e = new CoreError('OFFLINE', 'fetch failed: ECONNRESET 10.0.0.1')
    const trText = userMessage(e, i18n)
    expect(trText).toMatch(/nternet bağlantısı yok/)
    expect(trText).not.toContain('ECONNRESET')
    i18n.setPreference('en')
    expect(userMessage(e, i18n)).toMatch(/No internet connection/)
  })

  it('parametreler mesaja yerleşir ve kimlik eklenebilir', () => {
    const i18n = new I18n(['en'])
    const e = new CoreError('TOKEN_ENV_MISSING', 'x', { params: { fields: 'APPLE_TEAM_ID' } })
    expect(userMessage(e, i18n)).toContain('APPLE_TEAM_ID')
    expect(userMessageWithId(e, i18n)).toContain('TOKEN_003')
  })
})

describe('logError', () => {
  it('katalogdaki seviyeyle ve kimlikle loglar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('test', new CoreError('OFFLINE', 'ağ yok'))
    expect(warn).toHaveBeenCalledWith('[test] NET_001 OFFLINE: ağ yok')

    const cause = new Error('boom')
    const e = logError('test', cause, 'INTERNAL', 'beklenmeyen')
    expect(e.code).toBe('INTERNAL')
    expect(error).toHaveBeenCalledWith('[test] APP_003 INTERNAL: beklenmeyen', cause)
  })

  it('HTTP durumunu ekler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logError('api', new CoreError('UNAUTHORIZED', 'HTTP hatası', { status: 401 }))
    expect(warn).toHaveBeenCalledWith('[api] AUTH_001 UNAUTHORIZED: HTTP hatası (HTTP 401)')
  })
})
