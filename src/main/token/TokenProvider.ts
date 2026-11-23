import { CoreError, type ErrorCode } from '@shared/errors'

export interface TokenProvider {
  getDeveloperToken(): Promise<string>
  /**
   * Önbellekteki token'ı atar; sonraki `getDeveloperToken` yenisini üretir/ister. Apple süresi
   * dolmamış görünen token'ı reddettiğinde (401) kullanılır (PLAN_v5 A3.1).
   */
  invalidate(): void
}

/** Developer token hataları (katalogda `token` kategorisi). */
export type TokenErrorCode = Extract<
  ErrorCode,
  | 'TOKEN_ENV_MISSING' // zorunlu .env alanı yok veya boş
  | 'TOKEN_ENV_INVALID' // alan var ama biçimi hatalı
  | 'TOKEN_KEY_FILE_UNREADABLE' // APPLE_PRIVATE_KEY_PATH okunamadı
  | 'TOKEN_KEY_INVALID' // dosya geçerli bir PKCS#8 P-256 anahtarı değil
  | 'TOKEN_SIGN_FAILED'
  | 'TOKEN_PROVIDER_UNAVAILABLE' // production build: dev sağlayıcı yok (RemoteTokenProvider Faz 4)
>

// Mesajlar hangi ALANIN sorunlu olduğunu söyler; hiçbir zaman key içeriğini, dosya yolunu veya
// token'ı içermez. Alan adları kullanıcı mesajına `{fields}` parametresiyle gider.
export class TokenError extends CoreError {
  constructor(
    code: TokenErrorCode,
    message: string,
    readonly fields: readonly string[] = []
  ) {
    super(code, message, { params: { fields: fields.join(', ') } })
    this.name = 'TokenError'
  }
}
