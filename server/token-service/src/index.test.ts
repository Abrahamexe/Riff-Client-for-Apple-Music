import { decodeProtectedHeader, jwtVerify } from 'jose'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, resetCache, TOKEN_PATH, type Env } from './index'
import { importAppleKey, signDeveloperToken } from './jwt'

// Testte geçici bir P-256 anahtarı üretilir (gerçek .p8 ile ilgisi yok; ağ yok).
let pem = ''
let publicKey: CryptoKey
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`
  publicKey = pair.publicKey
})
beforeEach(() => {
  resetCache()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const env = (over: Partial<Env> = {}): Env => ({
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_KEY_ID: 'KEY1234567',
  APPLE_PRIVATE_KEY: pem,
  ...over
})
const get = (path = TOKEN_PATH, init: RequestInit = {}) =>
  new Request(`https://token.example${path}`, init)
const T0 = 1_800_000_000_000

describe('developer token imzası (4.1)', () => {
  it('Apple biçimi: ES256 + kid, iss = Team ID, iat/exp; imza doğrulanır', async () => {
    const key = await importAppleKey(pem)
    const { token, expiresAt } = await signDeveloperToken(key, {
      teamId: 'TEAM123456',
      keyId: 'KEY1234567',
      nowSec: 1000,
      ttlSec: 3600
    })
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'ES256', kid: 'KEY1234567' })
    const { payload } = await jwtVerify(token, publicKey, { currentDate: new Date(1500 * 1000) })
    expect(payload).toEqual({ iss: 'TEAM123456', iat: 1000, exp: 4600 })
    expect(expiresAt).toBe(4600)
  })

  it('bozuk anahtar: hata mesajı anahtar içeriği taşımaz', async () => {
    await expect(
      importAppleKey('-----BEGIN PRIVATE KEY-----\nQUJD\n-----END PRIVATE KEY-----')
    ).rejects.toThrow(/PKCS#8/)
  })
})

describe('token servisi (4.1)', () => {
  it('GET → { token, expiresAt }, önbelleğe alınmaz (no-store); 6 sa ömür', async () => {
    const res = await handle(get(), env(), () => T0)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { token: string; expiresAt: number }
    expect(body.expiresAt).toBe(T0 / 1000 + 6 * 3600)
    await expect(
      jwtVerify(body.token, publicKey, { currentDate: new Date(T0) })
    ).resolves.toBeTruthy()
  })

  it('ömrün yarısına kadar aynı token; sonra yenisi imzalanır', async () => {
    const tok = async (ms: number) =>
      ((await (await handle(get(), env(), () => ms)).json()) as { token: string }).token
    const a = await tok(T0)
    expect(await tok(T0 + 2 * 3600_000)).toBe(a)
    expect(await tok(T0 + 3 * 3600_000 + 1000)).not.toBe(a)
  })

  it('IP başına hız sınırı: aşımda 429 + Retry-After; anahtar IP', async () => {
    const limit = vi.fn(() => Promise.resolve({ success: false }))
    const res = await handle(
      get(TOKEN_PATH, { headers: { 'cf-connecting-ip': '203.0.113.7' } }),
      env({ RATE_LIMITER: { limit } }),
      () => T0
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('eksik/bozuk yapılandırma 500; yanıt ve log gizli bilgi içermez', async () => {
    const logSpy = vi.mocked(console.log)
    const missing = await handle(get(), env({ APPLE_PRIVATE_KEY: '' }), () => T0)
    expect(missing.status).toBe(500)
    const badKey = '-----BEGIN PRIVATE KEY-----\nGIZLIICERIK\n-----END PRIVATE KEY-----'
    const bad = await handle(get(), env({ APPLE_PRIVATE_KEY: badKey }), () => T0)
    expect(bad.status).toBe(500)
    const text = (await bad.text()) + JSON.stringify(logSpy.mock.calls)
    expect(text).not.toContain('GIZLIICERIK')
    expect(text).not.toContain('TEAM123456')
  })

  it('yalnızca GET ve bilinen yol; sağlık denetimi', async () => {
    expect((await handle(get(TOKEN_PATH, { method: 'POST' }), env())).status).toBe(405)
    expect((await handle(get('/baska'), env())).status).toBe(404)
    expect((await handle(get('/health'), env())).status).toBe(200)
  })
})
