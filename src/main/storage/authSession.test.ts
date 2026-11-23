import { describe, expect, it } from 'vitest'
import { decodeSession, encodeSession } from './authSession'

const TOKEN = 'AmUserToken0123456789+/='

describe('oturum kaydı (auth.bin içeriği)', () => {
  it.each([true, false, null])('kodla/çöz: restricted=%s', (restricted) => {
    expect(decodeSession(encodeSession({ token: TOKEN, restricted }))).toEqual({
      token: TOKEN,
      restricted
    })
  })

  it('eski biçim (ham token) okunur; kısıtlama bilinmiyor', () => {
    expect(decodeSession(TOKEN)).toEqual({ token: TOKEN, restricted: null })
  })

  it.each([
    ['yok', null, null],
    ['boşluklu ham token', 'a b', null],
    ['bozuk JSON', '{"v":1,', null],
    ['token eksik', '{"v":1,"restricted":false}', null],
    ['geçersiz token', '{"v":1,"token":"a b","restricted":false}', null],
    ['restricted string', `{"v":1,"token":"${TOKEN}","restricted":"0"}`, null]
  ])('geçersiz kayıt (%s) → null', (_l, stored, expected) => {
    expect(decodeSession(stored)).toBe(expected)
  })
})
