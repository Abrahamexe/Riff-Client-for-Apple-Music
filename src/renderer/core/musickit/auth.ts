import { CoreError } from '../errors'
import { getMusicKit } from './loader'

/** Kayıtlı oturum: Music User Token + hesabın içerik kısıtlaması (bilinmiyorsa `null`). */
export interface StoredSession {
  token: string
  restricted: boolean | null
}

/**
 * Oturumun kalıcı saklandığı yer (uygulamada IPC → main → safeStorage). Yazma yalnızca main'dedir
 * (giriş akışı); renderer okur ve siler. UI/IPC'den bağımsız tutulur.
 */
export interface UserTokenStore {
  load(): Promise<StoredSession | null>
  clear(): Promise<void>
}

/**
 * Oturumu MusicKit'e verir. Kısıtlama bilgisi verilmezse MusicKit bazı mağazalarda (ör. `tr`)
 * kısıtlamayı varsayılan açar ve explicit şarkıları kuyruktan siler (V4 bulgusu: "Content restricted").
 */
function applySession(session: StoredSession): void {
  const music = getMusicKit()
  music.musicUserToken = session.token
  accountRestricted = session.restricted
  applyContentRestriction(allowExplicitSetting)
}

/** Hesabın kısıtlaması (Apple `itre`); bilinmiyorsa `null`. */
let accountRestricted: boolean | null = null
/** Kullanıcı ayarı (3.B3, Apple: "Müstehcen müziğe izin ver"). */
let allowExplicitSetting = true

/**
 * Etkin içerik kısıtlaması = hesap kısıtlı VEYA kullanıcı müstehcene izin vermiyor. Hesap kısıtlıysa
 * yerel ayar bunu açamaz. Hesap bilinmiyor ve izin veriliyorsa MusicKit'e dokunulmaz (eski oturum).
 */
export function applyContentRestriction(allowExplicit: boolean): void {
  allowExplicitSetting = allowExplicit
  let music
  try {
    music = getMusicKit()
  } catch {
    return // MusicKit henüz yok: oturum uygulanınca bu değer kullanılır
  }
  if (!music.isAuthorized && music.musicUserToken === undefined) return
  if (accountRestricted === true || !allowExplicit) music.restrictedEnabled = true
  else if (accountRestricted === false) music.restrictedEnabled = false
}

export interface SessionState {
  authorized: boolean
  /** Oturum kayıtlı token'dan geri yüklendi (giriş penceresi açılmadı). */
  restored: boolean
}

/**
 * Açılışta: kayıtlı token varsa MusicKit'e yükler, giriş ekranını atlar. `configureMusicKit` sonrası
 * çağrılır. `syncStorefront: false` (R2): mağaza eşitlemesini (~0,8 sn) çağıran ayrıca yapar; arayüz
 * beklemez, kuyruk işlemleri onu bekler (bootstrap.ts).
 */
export async function restoreSession(
  store: UserTokenStore,
  { syncStorefront: sync = true }: { syncStorefront?: boolean } = {}
): Promise<SessionState> {
  const music = getMusicKit()
  if (music.isAuthorized) return { authorized: true, restored: false }

  const saved = await store.load()
  if (saved === null) return { authorized: false, restored: false }

  applySession(saved)
  if (music.isAuthorized && sync) await syncStorefront()
  return { authorized: music.isAuthorized, restored: music.isAuthorized }
}

const STOREFRONT_ID = /^[a-z]{2}$/

/**
 * Hesabın mağazasını MusicKit'e öğretir (2.1 bulgusu). MusicKit girişsiz yapılandırıldığında kullanıcı
 * mağazasını varsayılan `us` sanar; token sonradan verilince ilk katalog istekleri (setQueue) yanlış
 * mağazaya gider. `storefrontId`'yi doğrudan atamak YANLIŞ: kullanıcı mağazası ile API mağazası
 * farklıysa MusicKit `CONTENT_EQUIVALENT` fırlatır (gözlendi). Herkese açık `music.me()`
 * (`/me/account?meta=subscription`) kullanıcı mağazasını abonelikten ayarlar ve sonucu önbelleğe alır:
 * ilk çalmadaki aynı istek (~0,5 sn) de böylece önceden yapılmış olur. Hata (ağ yok) çalmayı
 * engellemez: false.
 */
export async function syncStorefront(): Promise<boolean> {
  const music = getMusicKit()
  try {
    await music.me()
    return STOREFRONT_ID.test(music.storefrontId)
  } catch {
    return false
  }
}

/**
 * Apple girişi (V3). `music.authorize()` KULLANILMAZ: Apple giriş sayfası token'ı `document.referrer`
 * origin'ine gönderir; `app://` origin'inden referrer gitmediği için popup akışı token'ı kaybeder.
 * Giriş penceresini main açar, token'ı şifreli depoya ve worker'a yazar ve buraya döndürür
 * (`authorize`, uygulamada IPC `auth:authorize`). Burada yalnızca MusicKit'e verilir.
 */
export async function signIn(authorize: () => Promise<StoredSession>): Promise<void> {
  const music = getMusicKit()
  let session: StoredSession
  try {
    session = await authorize()
  } catch (cause) {
    if (cause instanceof CoreError && cause.code !== 'AUTHORIZATION_FAILED') throw cause
    throw new CoreError('AUTHORIZATION_FAILED', 'Apple girişi tamamlanamadı veya iptal edildi.', {
      cause
    })
  }
  applySession(session)
  if (!music.isAuthorized) {
    throw new CoreError('AUTHORIZATION_FAILED', 'MusicKit dönen token’ı kabul etmedi.')
  }
  await syncStorefront()
}

/**
 * Çıkış: önce kayıtlı token ve yerel kullanıcı verisi silinir, sonra MusicKit oturumu kapatılır.
 * Sıra önemlidir: MusicKit'in Apple'a giden oturum kapatma isteği uzun sürebilir (V3 gözlemi: ~15 sn);
 * yerel veri bu süre boyunca diskte kalmamalı. Silme başarısız olsa bile MusicKit oturumu kapatılır.
 */
export async function signOut(store: UserTokenStore): Promise<void> {
  const music = getMusicKit()
  accountRestricted = null
  try {
    // 2.7 Y2: çalma önce durdurulur; silmeden sonra gelecek kayıt tetikleyicisi (durma olayı) kalmaz.
    await Promise.resolve()
      .then(() => music.stop())
      .catch(() => {})
    await store.clear()
  } finally {
    await music.unauthorize()
  }
}
