import { readFile } from 'node:fs/promises'
import { importPKCS8, SignJWT, type CryptoKey } from 'jose'
import { TokenError, type TokenProvider } from './TokenProvider'

// SADECE geliştirme içindir: .p8 yerelden okunur. Dağıtımdan önce RemoteTokenProvider'a geçilecek (Faz 4).

const ENV_TEAM_ID = 'APPLE_TEAM_ID'
const ENV_KEY_ID = 'APPLE_KEY_ID'
const ENV_KEY_PATH = 'APPLE_PRIVATE_KEY_PATH'

// Apple Team ID ve Key ID 10 karakterlik büyük harf/rakamdır.
const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/

const DEFAULT_TTL_SECONDS = 12 * 60 * 60
const MAX_TTL_SECONDS = 15777000 // Apple üst sınırı (~6 ay)
const REFRESH_MARGIN_SECONDS = 5 * 60

export interface DevTokenProviderOptions {
  env?: NodeJS.ProcessEnv
  /** Test için enjekte edilebilir; varsayılan: dosyadan oku. */
  readPrivateKey?: (path: string) => Promise<string>
  /** Unix saniyesi. Test için enjekte edilebilir. */
  now?: () => number
  ttlSeconds?: number
}

interface CachedToken {
  token: string
  exp: number
}

interface DevConfig {
  teamId: string
  keyId: string
  keyPath: string
}

export class DevTokenProvider implements TokenProvider {
  private readonly env: NodeJS.ProcessEnv
  private readonly readPrivateKey: (path: string) => Promise<string>
  private readonly now: () => number
  private readonly ttlSeconds: number

  private cached: CachedToken | null = null
  private inFlight: Promise<CachedToken> | null = null

  constructor(options: DevTokenProviderOptions = {}) {
    this.env = options.env ?? process.env
    this.readPrivateKey = options.readPrivateKey ?? ((path) => readFile(path, 'utf8'))
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000))
    this.ttlSeconds = Math.min(options.ttlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS)
  }

  async getDeveloperToken(): Promise<string> {
    const cached = this.cached
    if (cached && cached.exp - this.now() > REFRESH_MARGIN_SECONDS) return cached.token

    // Eşzamanlı çağrılar tek bir imzalama işlemini paylaşır.
    this.inFlight ??= this.issue().finally(() => {
      this.inFlight = null
    })
    this.cached = await this.inFlight
    return this.cached.token
  }

  invalidate(): void {
    this.cached = null
  }

  private readConfig(): DevConfig {
    const read = (name: string): string => (this.env[name] ?? '').trim()
    const teamId = read(ENV_TEAM_ID)
    const keyId = read(ENV_KEY_ID)
    const keyPath = read(ENV_KEY_PATH)

    const missing = [
      [ENV_TEAM_ID, teamId],
      [ENV_KEY_ID, keyId],
      [ENV_KEY_PATH, keyPath]
    ]
      .filter(([, value]) => value === '')
      .map(([name]) => name as string)

    if (missing.length > 0) {
      throw new TokenError(
        'TOKEN_ENV_MISSING',
        `.env eksik veya boş: ${missing.join(', ')}. .env.example'a bakıp .env dosyasını doldurun.`,
        missing
      )
    }

    const invalid = [
      [ENV_TEAM_ID, teamId],
      [ENV_KEY_ID, keyId]
    ]
      .filter(([, value]) => !APPLE_ID_PATTERN.test(value as string))
      .map(([name]) => name as string)

    if (invalid.length > 0) {
      throw new TokenError(
        'TOKEN_ENV_INVALID',
        `.env alanı hatalı: ${invalid.join(', ')} (10 karakterlik büyük harf/rakam olmalı, ör. ABC123DEFG).`,
        invalid
      )
    }

    return { teamId, keyId, keyPath }
  }

  private async issue(): Promise<CachedToken> {
    const { teamId, keyId, keyPath } = this.readConfig()

    let pem: string
    try {
      pem = await this.readPrivateKey(keyPath)
    } catch {
      throw new TokenError(
        'TOKEN_KEY_FILE_UNREADABLE',
        // Yol mesaja yazılmaz: kullanıcı adını içerebilir (Güvenlik kuralı 10).
        `${ENV_KEY_PATH} okunamadı. Dosyanın var olduğunu ve yolun doğru olduğunu kontrol edin.`,
        [ENV_KEY_PATH]
      )
    }

    let key: CryptoKey
    try {
      key = await importPKCS8(pem, 'ES256')
    } catch {
      throw new TokenError(
        'TOKEN_KEY_INVALID',
        `${ENV_KEY_PATH} geçerli bir Apple MusicKit .p8 anahtarı değil (PKCS#8, P-256 bekleniyor).`,
        [ENV_KEY_PATH]
      )
    }

    const iat = this.now()
    const exp = iat + this.ttlSeconds
    try {
      const token = await new SignJWT({ iss: teamId })
        .setProtectedHeader({ alg: 'ES256', kid: keyId })
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key)
      return { token, exp }
    } catch {
      throw new TokenError('TOKEN_SIGN_FAILED', 'Developer token imzalanamadı.')
    }
  }
}
