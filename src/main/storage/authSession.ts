import { AuthSessionSchema, UserTokenSchema, type AuthSession } from '@shared/ipc-contract'

// Şifreli depoda (SecureStore, auth.bin) tutulan oturum kaydı (V3/V4 bulgusu). Token'ın yanında
// hesabın içerik kısıtlaması (`restricted`, Apple'ın `itre` alanı) saklanır: MusicKit bu bayrak
// bilinmediğinde bazı mağazalarda (ör. `tr`) kısıtlamayı VARSAYILAN açar ve explicit şarkıları
// kuyruktan siler ("Content restricted"). MusicKit'in kendi deposu bellek içi oturumda olduğundan
// her açılışta bayrak buradan verilir.

const VERSION = 1

export function encodeSession(session: AuthSession): string {
  return JSON.stringify({ v: VERSION, token: session.token, restricted: session.restricted })
}

/**
 * Kayıtlı değeri çözer. Eski biçim (yalnızca ham token) `restricted: null` ile okunur. Geçersizse
 * `null` (çağıran yeniden girişe yönlendirir).
 */
export function decodeSession(stored: string | null): AuthSession | null {
  if (stored === null) return null
  if (!stored.startsWith('{')) {
    return UserTokenSchema.safeParse(stored).success ? { token: stored, restricted: null } : null
  }
  try {
    const parsed = AuthSessionSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
