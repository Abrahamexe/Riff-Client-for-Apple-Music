import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { CoreError, logError } from '@shared/errors'
import { devEnvFilePath } from '../platform/devPaths'
import type { AppPathSource } from '../platform/paths'
import { DevTokenProvider } from './DevTokenProvider'

// YALNIZCA DEV BUILD (PLAN 1.10): bu modül main'den `if (__DEV_BUILD__) await import(...)` ile
// yüklenir; production build'inde dal derleme zamanında silinir, .env/.p8 okuyan kod bundle'a girmez
// (scripts/verify-prod-bundle.mjs doğrular). Faz 4'te yerini RemoteTokenProvider alır.
//
// .env içeriği process.env'e YAZILMAZ: yalnızca bu sağlayıcıya özel bir nesnede tutulur. Böylece
// renderer/worker gibi alt süreçler ortam değişkeni olarak devralmaz (Güvenlik kuralı 1).

/** .env dosyasını ayrıştırır; dosya yoksa boş nesne. İçerik loglanmaz. */
export function readDevEnv(envPath: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(envPath, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logError(
        'env',
        new CoreError('TOKEN_ENV_INVALID', `.env okunamadı (${code ?? 'bilinmeyen hata'})`)
      )
    }
    return {}
  }
  return parseEnv(text) as Record<string, string>
}

/** Dev build'in developer token sağlayıcısı: kabuk ortamı + .env (öncelik .env'de). */
export function createDevTokenProvider(envPath: string): DevTokenProvider {
  // YALNIZCA test (PLAN 2.3): `AM_DEV_TOKEN_TTL_SECONDS` ile kısa ömürlü token — oturum ortasında
  // dolma senaryosu gerçek Apple ile denenir. Değer kabuk ortamından okunur (.env'den değil).
  const ttl = Number(process.env['AM_DEV_TOKEN_TTL_SECONDS'])
  return new DevTokenProvider({
    env: { ...process.env, ...readDevEnv(envPath) },
    ...(Number.isInteger(ttl) && ttl >= 30 ? { ttlSeconds: ttl } : {})
  })
}

/** Dev build'in developer token sağlayıcısı, platform yoluyla (proje kökü veya userData). */
export function createDevTokenProviderFor(app: AppPathSource): DevTokenProvider {
  return createDevTokenProvider(devEnvFilePath(app))
}
