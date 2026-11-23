import { beforeAll, describe, expect, it } from 'vitest'
import {
  decodeJwt,
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  type CryptoKey
} from 'jose'
import { DevTokenProvider } from './DevTokenProvider'
import { TokenError } from './TokenProvider'

const TEAM_ID = 'TEAM123456'
const KEY_ID = 'KEY1234567'
const KEY_PATH = 'C:\\secrets\\AuthKey_TEST.p8'
const NOW = 1_800_000_000
const TWELVE_HOURS = 12 * 60 * 60

// Test anahtarı yalnızca bellekte yaşar: ne diske ne repoya yazılır.
let publicKey: CryptoKey
let privatePem: string

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true })
  publicKey = pair.publicKey
  privatePem = await exportPKCS8(pair.privateKey)
})

const validEnv = (): NodeJS.ProcessEnv => ({
  APPLE_TEAM_ID: TEAM_ID,
  APPLE_KEY_ID: KEY_ID,
  APPLE_PRIVATE_KEY_PATH: KEY_PATH
})

const makeProvider = (
  overrides: ConstructorParameters<typeof DevTokenProvider>[0] = {}
): DevTokenProvider =>
  new DevTokenProvider({
    env: validEnv(),
    readPrivateKey: async () => privatePem,
    now: () => NOW,
    ...overrides
  })

async function rejection(promise: Promise<unknown>): Promise<TokenError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(TokenError)
    return err as TokenError
  }
  throw new Error('Promise reddedilmedi')
}

describe('DevTokenProvider — JWT üretimi', () => {
  it('header ve payload doğru: alg, kid, iss, iat, exp', async () => {
    const token = await makeProvider().getDeveloperToken()

    const header = decodeProtectedHeader(token)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(KEY_ID)

    const payload = decodeJwt(token)
    expect(payload.iss).toBe(TEAM_ID)
    expect(payload.iat).toBe(NOW)
    expect(payload.exp).toBe(NOW + TWELVE_HOURS)
  })

  it('imza test public key ile doğrulanıyor', async () => {
    const token = await makeProvider().getDeveloperToken()
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['ES256'],
      issuer: TEAM_ID,
      currentDate: new Date(NOW * 1000)
    })
    expect(payload.iss).toBe(TEAM_ID)
  })

  it('TTL Apple üst sınırını (15777000 sn) aşmıyor', async () => {
    const token = await makeProvider({ ttlSeconds: 999_999_999 }).getDeveloperToken()
    const { iat, exp } = decodeJwt(token)
    expect(exp! - iat!).toBe(15777000)
  })
})

describe('DevTokenProvider — cache', () => {
  it('süre dolmadan aynı token döner, imzalama tekrarlanmaz', async () => {
    let now = NOW
    let reads = 0
    const provider = makeProvider({
      now: () => now,
      readPrivateKey: async () => {
        reads++
        return privatePem
      }
    })
    const first = await provider.getDeveloperToken()
    now += 60 * 60
    expect(await provider.getDeveloperToken()).toBe(first)
    expect(reads).toBe(1)
  })

  it('süre dolmaya yaklaşınca (5 dk kala) yeni token üretir', async () => {
    let now = NOW
    const provider = makeProvider({ now: () => now })
    const first = await provider.getDeveloperToken()
    now += TWELVE_HOURS - 4 * 60
    const second = await provider.getDeveloperToken()
    expect(second).not.toBe(first)
    expect(decodeJwt(second).iat).toBe(now)
  })

  it('eşzamanlı çağrılar tek imzalamayı paylaşır', async () => {
    let reads = 0
    const provider = makeProvider({
      readPrivateKey: async () => {
        reads++
        return privatePem
      }
    })
    const [a, b] = await Promise.all([provider.getDeveloperToken(), provider.getDeveloperToken()])
    expect(a).toBe(b)
    expect(reads).toBe(1)
  })

  it('invalidate → süresi dolmamış olsa da yeni token imzalanır (A3.1)', async () => {
    let now = NOW
    let reads = 0
    const provider = makeProvider({
      now: () => now,
      readPrivateKey: async () => {
        reads++
        return privatePem
      }
    })
    const first = await provider.getDeveloperToken()
    now += 60
    provider.invalidate()
    const second = await provider.getDeveloperToken()
    expect(second).not.toBe(first)
    expect(reads).toBe(2)
    expect(await provider.getDeveloperToken()).toBe(second)
  })
})

describe('DevTokenProvider — hata mesajları', () => {
  it('.env tamamen boşsa üç alanı da adıyla söyler', async () => {
    const err = await rejection(makeProvider({ env: {} }).getDeveloperToken())
    expect(err.code).toBe('TOKEN_ENV_MISSING')
    expect(err.fields).toEqual(['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY_PATH'])
    for (const name of err.fields) expect(err.message).toContain(name)
  })

  it('boş string ve sadece boşluk "eksik" sayılır', async () => {
    const env = { ...validEnv(), APPLE_KEY_ID: '', APPLE_TEAM_ID: '   ' }
    const err = await rejection(makeProvider({ env }).getDeveloperToken())
    expect(err.code).toBe('TOKEN_ENV_MISSING')
    expect(err.fields).toEqual(['APPLE_TEAM_ID', 'APPLE_KEY_ID'])
  })

  it('yalnızca eksik olan alanı belirtir', async () => {
    const env = { ...validEnv() }
    delete env.APPLE_PRIVATE_KEY_PATH
    const err = await rejection(makeProvider({ env }).getDeveloperToken())
    expect(err.fields).toEqual(['APPLE_PRIVATE_KEY_PATH'])
    expect(err.message).not.toContain('APPLE_TEAM_ID')
  })

  it('biçimi hatalı Team ID / Key ID için TOKEN_ENV_INVALID verir', async () => {
    const env = { ...validEnv(), APPLE_TEAM_ID: 'kisa', APPLE_KEY_ID: 'AB-1234567' }
    const err = await rejection(makeProvider({ env }).getDeveloperToken())
    expect(err.code).toBe('TOKEN_ENV_INVALID')
    expect(err.fields).toEqual(['APPLE_TEAM_ID', 'APPLE_KEY_ID'])
  })

  it('.p8 dosyası okunamazsa TOKEN_KEY_FILE_UNREADABLE verir, yolu mesaja yazmaz', async () => {
    const provider = makeProvider({
      readPrivateKey: async () => {
        throw new Error('ENOENT')
      }
    })
    const err = await rejection(provider.getDeveloperToken())
    expect(err.code).toBe('TOKEN_KEY_FILE_UNREADABLE')
    expect(err.fields).toEqual(['APPLE_PRIVATE_KEY_PATH'])
    expect(err.message).not.toContain(KEY_PATH)
  })

  it('geçersiz key içeriği için TOKEN_KEY_INVALID verir ve içeriği mesaja sızdırmaz', async () => {
    const garbage = '-----BEGIN PRIVATE KEY-----\nGIZLI-ICERIK\n-----END PRIVATE KEY-----'
    const err = await rejection(
      makeProvider({ readPrivateKey: async () => garbage }).getDeveloperToken()
    )
    expect(err.code).toBe('TOKEN_KEY_INVALID')
    expect(err.message).not.toContain('GIZLI-ICERIK')
  })

  it('hata mesajları key PEM içeriğini içermez', async () => {
    const err = await rejection(makeProvider({ env: {} }).getDeveloperToken())
    expect(err.message).not.toContain('BEGIN PRIVATE KEY')
    expect(err.message).not.toContain(privatePem.split('\n')[1]!)
  })
})

// Gerçek Apple API çağrısı gerektiren kabul testi: geçerli .p8 / Key ID / Team ID olmadan çalıştırılamaz.
describe('Kabul testi (gerçek Apple API)', () => {
  it.todo(
    '[Apple key bekleniyor] GET https://api.music.apple.com/v1/catalog/tr/search?term=test&types=songs → 200'
  )
})
