import { jwtVerify } from 'jose'
import { describe, expect, it, vi } from 'vitest'
import { handle, resetCache } from '../server/token-service/src/index'
import { RemoteTokenProvider } from '../src/main/token/RemoteTokenProvider'

// PLAN 4.1 uçtan uca (ağsız): istemcinin isteği doğrudan sunucu işleyicisine verilir. Geçici P-256
// anahtarı; gerçek .p8 ve Apple kullanılmaz.
describe('token servisi ↔ RemoteTokenProvider (4.1)', () => {
  it('sunucunun imzaladığı token istemcide doğrulanıp önbelleğe alınır; imza açık anahtarla geçerli', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    resetCache()
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify'
    ])
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----`
    const env = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: pem }
    const nowMs = 1_800_000_000_000
    const server = vi.fn((input: URL, init?: RequestInit) =>
      handle(new Request(input.href, init), env, () => nowMs)
    )
    const provider = new RemoteTokenProvider({
      url: 'https://token.example/v1/developer-token',
      appVersion: '1.0.0',
      fetch: server as unknown as typeof fetch,
      now: () => nowMs / 1000
    })
    const token = await provider.getDeveloperToken()
    await provider.getDeveloperToken()
    expect(server).toHaveBeenCalledTimes(1)
    const { payload, protectedHeader } = await jwtVerify(token, pair.publicKey, {
      currentDate: new Date(nowMs)
    })
    expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' })
    expect(payload.iss).toBe('TEAM123456')
    vi.restoreAllMocks()
  })
})
