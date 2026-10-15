// Apple Music developer token (ES256 JWT) imzalama — bağımlılıksız, WebCrypto (Cloudflare Workers ve
// Node 24'te aynı API). Apple biçimi: başlık { alg: ES256, kid: KEY_ID }, gövde { iss: TEAM_ID, iat,
// exp } (developer.apple.com/documentation/applemusicapi/generating-developer-tokens). WebCrypto ECDSA
// imzası doğrudan JWS'nin istediği r||s (IEEE P1363) biçimindedir.

export const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/
/** Apple üst sınırı ~6 ay; burada kısa ömür kullanılır (PLAN 4.1). */
export const MAX_TTL_SECONDS = 15_777_000

const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const jsonPart = (value: unknown): string => base64url(encoder.encode(JSON.stringify(value)))

/** PKCS#8 PEM (Apple'ın .p8 içeriği) → imzalama anahtarı. Hata mesajı anahtar içeriği taşımaz. */
export async function importAppleKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  let der: Uint8Array<ArrayBuffer>
  try {
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  } catch {
    throw new Error('APPLE_PRIVATE_KEY base64 değil')
  }
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
  } catch {
    throw new Error('APPLE_PRIVATE_KEY geçerli bir PKCS#8 P-256 anahtarı değil')
  }
}

export interface SignOptions {
  teamId: string
  keyId: string
  /** Unix saniyesi */
  nowSec: number
  ttlSec: number
}

export async function signDeveloperToken(
  key: CryptoKey,
  { teamId, keyId, nowSec, ttlSec }: SignOptions
): Promise<{ token: string; expiresAt: number }> {
  if (!APPLE_ID_PATTERN.test(teamId) || !APPLE_ID_PATTERN.test(keyId)) {
    throw new Error('APPLE_TEAM_ID / APPLE_KEY_ID biçimi hatalı')
  }
  const exp = nowSec + Math.min(Math.max(60, Math.trunc(ttlSec)), MAX_TTL_SECONDS)
  const input = `${jsonPart({ alg: 'ES256', kid: keyId })}.${jsonPart({ iss: teamId, iat: nowSec, exp })}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(input)
  )
  return { token: `${input}.${base64url(new Uint8Array(signature))}`, expiresAt: exp }
}
