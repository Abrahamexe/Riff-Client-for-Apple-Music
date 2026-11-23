import { TokenError, type TokenProvider } from './TokenProvider'

// Token servisi adresi olmadan derlenmiş production build'inin sağlayıcısı (PLAN 1.10): .env/.p8
// hiçbir koşulda aranmaz. Dağıtım build'i `AM_TOKEN_SERVICE_URL` ile RemoteTokenProvider kullanır (4.1).
export class UnavailableTokenProvider implements TokenProvider {
  getDeveloperToken(): Promise<string> {
    return Promise.reject(
      new TokenError(
        'TOKEN_PROVIDER_UNAVAILABLE',
        'Bu sürümde developer token sağlayıcısı yok. Geliştirme için dev build kullanın (npm run dev / build:dev).'
      )
    )
  }

  invalidate(): void {}
}
