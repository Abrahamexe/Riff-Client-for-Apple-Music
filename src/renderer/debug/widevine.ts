export interface WidevineReport {
  available: boolean
  keySystem?: string
  robustness?: string
  mediaKeysCreated?: boolean
  error?: string
}

export const WIDEVINE_KEY_SYSTEM = 'com.widevine.alpha'

function configFor(robustness: string): MediaKeySystemConfiguration[] {
  return [
    {
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness }],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness }],
      persistentState: 'optional',
      distinctiveIdentifier: 'optional',
      sessionTypes: ['temporary']
    }
  ]
}

// Önce 'SW_SECURE_CRYPTO' (robustness uyarısı vermez), olmazsa boş robustness denenir; ilk başarılı olan raporlanır.
export async function checkWidevine(): Promise<WidevineReport> {
  let lastError = 'bilinmeyen hata'
  for (const robustness of ['SW_SECURE_CRYPTO', '']) {
    try {
      const access = await navigator.requestMediaKeySystemAccess(
        WIDEVINE_KEY_SYSTEM,
        configFor(robustness)
      )
      const keys = await access.createMediaKeys()
      return {
        available: true,
        keySystem: access.keySystem,
        robustness: robustness || '(varsayılan)',
        mediaKeysCreated: keys instanceof MediaKeys
      }
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
  }
  return { available: false, error: lastError }
}
