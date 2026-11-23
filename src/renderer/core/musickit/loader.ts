import { CoreError, logError } from '../errors'
import type { MusicKitInstance, MusicKitStatic } from './types'

// Apple'ın CDN'inden yüklenir; lisans gereği dosya kopyalanmaz/yeniden barındırılmaz.
const MUSICKIT_SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
const LOAD_TIMEOUT_MS = 15_000

export interface AppInfo {
  name: string
  build: string
}

let loading: Promise<MusicKitStatic> | null = null

/** Yeniden deneme beklemeleri (ms): toplam 3 deneme (PLAN 2.3; V4'te ağ dalgalanmasında MK_001 görüldü). */
export const MUSICKIT_RETRY_DELAYS_MS = [1_000, 3_000] as const

export interface LoadOptions {
  /** Test için enjekte edilebilir. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * MusicKit JS v3 script'ini yükler ve `musickitloaded` event'ini bekler. Ağ hatasında artan
 * beklemeyle yeniden dener; tükenirse son hata fırlatılır ve sonraki çağrı baştan dener (ör. ağ
 * geri gelince). Tekrar çağrı süren yüklemenin promise'ini döner.
 */
export function loadMusicKit({ sleep = defaultSleep }: LoadOptions = {}): Promise<MusicKitStatic> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit)
  loading ??= (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= MUSICKIT_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(MUSICKIT_RETRY_DELAYS_MS[attempt - 1]!)
      try {
        return await loadOnce()
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  })().finally(() => {
    loading = null
  })
  return loading
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function loadOnce(): Promise<MusicKitStatic> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit)
  return new Promise<MusicKitStatic>((resolve, reject) => {
    const fail = (error: CoreError): void => {
      cleanup()
      // Başarısız script etiketi kaldırılır: sonraki deneme yeni bir etiketle yeniden indirir.
      script.remove()
      reject(error)
    }
    const onLoaded = (): void => {
      if (!window.MusicKit) {
        fail(new CoreError('MUSICKIT_LOAD_FAILED', 'musickitloaded tetiklendi ama MusicKit yok.'))
        return
      }
      cleanup()
      resolve(window.MusicKit)
    }
    const timer = setTimeout(
      () =>
        fail(
          new CoreError(
            'MUSICKIT_LOAD_TIMEOUT',
            `MusicKit ${LOAD_TIMEOUT_MS / 1000} sn içinde yüklenmedi (ağ veya CSP engeli olabilir).`
          )
        ),
      LOAD_TIMEOUT_MS
    )
    const script = document.createElement('script')
    const cleanup = (): void => {
      clearTimeout(timer)
      document.removeEventListener('musickitloaded', onLoaded)
      script.onerror = null
    }

    // Listener script eklenmeden ÖNCE kaydedilir; event kaçırılmaz.
    document.addEventListener('musickitloaded', onLoaded)
    script.src = MUSICKIT_SCRIPT_URL
    script.async = true
    script.onerror = () =>
      fail(
        new CoreError(
          'MUSICKIT_LOAD_FAILED',
          'MusicKit script yüklenemedi (ağ yok veya CSP script-src engelledi).'
        )
      )
    document.head.appendChild(script)
  })
}

let lastSetup: { getDeveloperToken: () => Promise<string>; app: AppInfo } | null = null
let configuredAtMs: number | null = null

/** Son başarılı `configure` zamanı (ms); yeniden bağlanınca token tazeliği için (PLAN 2.3). */
export function musicKitConfiguredAt(): number | null {
  return configuredAtMs
}

async function configureWith(
  musicKit: MusicKitStatic,
  getDeveloperToken: () => Promise<string>,
  app: AppInfo
): Promise<MusicKitInstance> {
  let developerToken: string
  try {
    developerToken = await getDeveloperToken()
  } catch (cause) {
    throw new CoreError('DEVELOPER_TOKEN_UNAVAILABLE', 'Developer token alınamadı.', { cause })
  }

  let instance: MusicKitInstance
  try {
    instance = await musicKit.configure({ developerToken, app })
  } catch (cause) {
    throw new CoreError('MUSICKIT_CONFIGURE_FAILED', 'MusicKit.configure başarısız oldu.', {
      cause
    })
  }
  scheduleTokenRefresh(developerToken)
  return instance
}

/** Developer token dolmadan bu kadar önce MusicKit yeniden yapılandırılır (PLAN 2.3). */
export const TOKEN_REFRESH_BEFORE_MS = 10 * 60_000
const MIN_REFRESH_DELAY_MS = 60_000
let refreshTimer: ReturnType<typeof setTimeout> | null = null

/** JWT `exp` (sn); imza doğrulanmaz (yalnızca zamanlama için). Okunamazsa `null`. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}

/**
 * Token dolmadan önce önden yenileme (PLAN 2.3; Faz 4.1'in kısa ömürlü token'ları için gerekli).
 * Gerçek gözlem: Apple dolmuş token'ı hemen reddetmedi (40 sn ömürlü token 3 dk sonra kabul edildi);
 * yine de buna güvenilmez. Yenileme kullanıcı token'ını korur (reconfigureMusicKit).
 */
function scheduleTokenRefresh(token: string, now = Date.now()): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  const exp = jwtExpiry(token)
  if (exp === null) return
  const delay = Math.max(MIN_REFRESH_DELAY_MS, exp * 1000 - now - TOKEN_REFRESH_BEFORE_MS)
  refreshTimer = setTimeout(
    () => {
      refreshTimer = null
      reconfigureMusicKit().catch((err: unknown) =>
        logError(
          'musickit',
          err,
          'DEVELOPER_TOKEN_UNAVAILABLE',
          'Developer token önden yenilenemedi.'
        )
      )
    },
    Math.min(delay, 2_147_483_647)
  )
}

/**
 * MusicKit'i yükler ve developer token ile yapılandırır. UI'dan bağımsızdır:
 * token kaynağı dışarıdan verilir (IPC, ileride RemoteTokenProvider).
 */
export async function configureMusicKit(
  getDeveloperToken: () => Promise<string>,
  app: AppInfo
): Promise<MusicKitInstance> {
  const musicKit = await loadMusicKit()
  const instance = await configureWith(musicKit, getDeveloperToken, app)
  lastSetup = { getDeveloperToken, app }
  configuredAtMs = Date.now()
  return instance
}

/**
 * Developer token süresi dolduğunda (PLAN 1.9): yeni token alır ve `configure`'ı tekrarlar.
 * Mevcut user token ve içerik kısıtlaması korunur (configure sonrası yeniden atanır).
 */
export async function reconfigureMusicKit(): Promise<MusicKitInstance> {
  if (!lastSetup) {
    throw new CoreError('MUSICKIT_NOT_CONFIGURED', 'MusicKit henüz yapılandırılmadı.')
  }
  const musicKit = await loadMusicKit()
  const previous = getMusicKit()
  const userToken = previous.musicUserToken
  // 2.7 O3: içerik kısıtlaması da korunur; aksi halde MusicKit bazı mağazalarda (tr) kısıtlamayı
  // varsayılan açar ve explicit şarkıları kuyruktan siler (V4 bulgusu). 3.B3: kullanıcı ayarlarından
  // gelen çalma özellikleri de taşınır (ses kalitesi 64'e düşmesin).
  const kept = {
    restrictedEnabled: previous.restrictedEnabled,
    bitrate: previous.bitrate,
    autoplayEnabled: previous.autoplayEnabled,
    privateEnabled: previous.privateEnabled
  }
  const instance = await configureWith(musicKit, lastSetup.getDeveloperToken, lastSetup.app)
  if (userToken) instance.musicUserToken = userToken
  if (kept.restrictedEnabled !== undefined && userToken) {
    instance.restrictedEnabled = kept.restrictedEnabled
  }
  if (typeof kept.bitrate === 'number') instance.bitrate = kept.bitrate
  if (typeof kept.autoplayEnabled === 'boolean') instance.autoplayEnabled = kept.autoplayEnabled
  if (typeof kept.privateEnabled === 'boolean') instance.privateEnabled = kept.privateEnabled
  configuredAtMs = Date.now()
  return instance
}

/** `configureMusicKit` başarıyla tamamlandıktan sonra kullanılır. */
export function getMusicKit(): MusicKitInstance {
  const notConfigured = (cause?: unknown): CoreError =>
    new CoreError('MUSICKIT_NOT_CONFIGURED', 'MusicKit henüz yapılandırılmadı.', { cause })
  if (!window.MusicKit) throw notConfigured()
  let instance: MusicKitInstance | undefined
  try {
    instance = window.MusicKit.getInstance()
  } catch (cause) {
    throw notConfigured(cause)
  }
  // v3: configure çağrılmadan getInstance() hata vermez, undefined döner.
  if (!instance) throw notConfigured()
  return instance
}
