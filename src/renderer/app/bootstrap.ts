import {
  restoreSession,
  signIn,
  signOut,
  syncStorefront,
  type SessionState
} from '@core/musickit/auth'
import { setGuardHandlers } from '@core/musickit/guard'
import { LibraryClient } from '@core/data/library'
import { persistPlayerState, restorePlayerState } from '@core/data/playerState'
import { SearchController } from '@core/data/search'
import { appleMusicLink, type LinkKind } from '@core/data/links'
import { applyPlaybackSettings, SettingsClient } from '@core/settings/settings'
import { bindEqualizer, Equalizer, type EqualizerBinding } from '@core/audio/equalizer'
import { defaultSettings } from '@shared/settings'
import {
  configureMusicKit,
  getMusicKit,
  musicKitConfiguredAt,
  reconfigureMusicKit
} from '@core/musickit/loader'
import { onReconnect, refreshAfterReconnect } from '@core/system'
import { bindMediaSession } from '@core/musickit/mediaSession'
import { Player } from '@core/musickit/player'
import { connectPlayerToHub } from '@core/player/hubPublisher'
import { BackgroundClient, connectBackgroundPrefetch } from '@core/background/background'
import { TypedEmitter } from '@core/emitter'
import { CoreError, toCoreError } from '@core/errors'
import { i18n } from '@core/i18n'
import { CdmGate } from '@core/cdm'
import type { CdmStatus } from '@shared/types'
import type { ExternalLink } from '@shared/ipc-contract'
import { ipcCdmSource } from '../cdmSource'
import { unwrap } from '../ipc'
import { ipcHubPort } from '../playerHub'
import { ipcAuthorize, ipcUserTokenStore } from '../tokenStore'

// Uygulama kabuğu (PLAN_v5 P6): çekirdek servislerin UI'dan bağımsız bağlanması. Önceden debug
// panelinin içindeydi; arayüz (Faz B) ve dev'e özel debug paneli aynı nesneyi tüketir.
// Sıra (değiştirilmez): CDM izlenir → MusicKit yapılandırılır → ayarlar (oturumdan önce: içerik
// kısıtlaması oturumla birleşir) → Player bağlanır → kayıtlı oturum + son kuyruk → ayarlar uygulanır.
// `info` olayları yalnızca tanılama içindir (debug paneli basar); kullanıcıya gösterilmez.

export interface AppEvents {
  /** Tanılama satırı (debug paneli). Kullanıcı metni değildir. */
  info: string
  /** Bir adım başarısız oldu; `context` hangi adım olduğunu söyler (tanılama). */
  error: { error: CoreError; context: string }
  cdm: CdmStatus
  /** MusicKit yapılandırıldı. */
  musicKitReady: { storefront: string }
  /** Player oluşturuldu ve servislere bağlandı. */
  playerReady: Player
  /** Oturum durumu: açılışta geri yükleme sonucu; B8: arayüzden giriş / çıkış sonrası da. */
  session: SessionState
  /** Son kuyruk (çalmadan) geri yüklendi; oturumdan sonra, arka planda (R2). */
  queueRestored: undefined
  /** Apple oturumu geçersiz: kayıtlı token silindi, yeniden giriş gerekir. */
  unauthorized: CoreError
  /** Uyku / ağ dönüşünden sonra yapılan toparlanma adımları. */
  reconnected: string[]
}

export interface AppInfo {
  name: string
  build: string
}

export class App extends TypedEmitter<AppEvents> {
  readonly cdm = new CdmGate(ipcCdmSource)
  readonly library = new LibraryClient()
  readonly background = new BackgroundClient()
  readonly settings = new SettingsClient()
  readonly equalizer = new Equalizer()
  private playerInstance: Player | null = null
  private searchInstance: SearchController | null = null
  private signedInState: boolean | null = null
  private eqBinding: EqualizerBinding | null = null
  private disposers: (() => void)[] = []

  constructor(private readonly info: AppInfo) {
    super()
  }

  /** Uygulama adı ve sürümü (Ayarlar → Hakkında). */
  get appInfo(): AppInfo {
    return this.info
  }

  /** Player (MusicKit yapılandırılmadıysa oluşturulamaz → hata). */
  get player(): Player {
    if (!this.playerInstance) this.attachPlayer()
    return this.playerInstance!
  }

  get hasPlayer(): boolean {
    return this.playerInstance !== null
  }

  /** Açılış: tek kez çağrılır. Hatalar `error` olayıyla bildirilir, fırlatılmaz. */
  async start(): Promise<void> {
    this.disposers.push(this.cdm.on('status', (status) => this.emit('cdm', status)))
    this.installGuards()
    this.disposers.push(this.settings.onChange(() => this.applySettings()))
    this.disposers.push(
      this.library.onWriteFailed((op, err) =>
        this.emit('error', { error: err, context: `Kütüphane yazması geri alındı (${op})` })
      )
    )
    this.watchReconnect()
    void this.cdm.start().catch((err) => this.fail(err, 'CDM durumu alınamadı'))
    await this.startMusicKit()
  }

  /** MusicKit'i yükler, yapılandırır, oturumu ve son kuyruğu geri yükler (uykudan dönüşte de). */
  async startMusicKit(): Promise<void> {
    this.emit('info', 'MusicKit yükleniyor ve yapılandırılıyor…')
    try {
      await configureMusicKit(
        async () => (await unwrap(window.api.getDeveloperToken())).token,
        this.info
      )
      this.emit('musicKitReady', { storefront: getMusicKit().storefrontId })
      await this.loadSettings()
      this.attachPlayer()
      await this.restore()
      this.applySettings()
    } catch (err) {
      this.fail(err, 'MusicKit başlatılamadı')
    }
  }

  /** Oturum açık mı (B8 hesap satırı); açılışta geri yükleme bitene kadar `null`. */
  get signedIn(): boolean | null {
    return this.signedInState
  }

  async signIn(): Promise<void> {
    await signIn(ipcAuthorize)
    this.applySettings()
    this.setSession(true)
  }

  async signOut(): Promise<void> {
    try {
      await signOut(ipcUserTokenStore)
    } finally {
      this.setSession(false)
    }
  }

  /** Ayarlar → Gelişmiş "Önbelleği sıfırla": kapak ve müzik arka planı önbellekleri (oturum kalır). */
  async resetCaches(): Promise<void> {
    await unwrap(window.api.clearArtworkCache())
    await unwrap(window.api.worker.clearBackgroundCache({}))
  }

  /** Menüler "Bağlantıyı Kopyala": katalog öğesinin Apple Music bağlantısı panoya; arşiv öğesi → hata. */
  async copyLink(kind: LinkKind, id: string): Promise<void> {
    const url = appleMusicLink(getMusicKit().storefrontId, kind, id)
    if (!url) throw new CoreError('INVALID_ARGUMENT', 'Bu öğenin paylaşım bağlantısı yok.')
    await unwrap(window.api.copyAppleMusicLink(url))
  }

  /** Varsayılan tarayıcıda bilinen Apple sayfası (B8 "Aboneliği Yönet"; adres main'de sabit). */
  async openExternal(link: ExternalLink): Promise<void> {
    await unwrap(window.api.openExternalLink(link))
  }

  /** Müzik arka planı / Hakkında kaynak bağlantısı (Wikipedia, MusicBrainz …; main doğrular). */
  async openSourceLink(url: string): Promise<void> {
    await unwrap(window.api.openSourceLink(url))
  }

  private setSession(authorized: boolean): void {
    this.signedInState = authorized
    this.emit('session', { authorized, restored: false })
  }

  /** Arayüz araması (B7): yazarken yalnızca öneri; sonuç sayfası `find()` ile arar. */
  get search(): SearchController {
    this.searchInstance ??= new SearchController(window.api.worker, { liveResults: false })
    return this.searchInstance
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off()
    this.eqBinding?.dispose()
    this.searchInstance?.dispose()
  }

  private installGuards(): void {
    // PLAN 1.9: 401/403 → user token silinir, yeniden giriş istenir; developer token dolmuşsa yenilenir.
    setGuardHandlers({
      onUnauthorized: async (error) => {
        await ipcUserTokenStore.clear().catch(() => {})
        this.signedInState = false
        this.emit('unauthorized', error)
      },
      onDeveloperTokenExpired: async () => {
        this.emit(
          'info',
          'Developer token süresi dolmuş; yenilenip MusicKit yeniden yapılandırılıyor…'
        )
        await reconfigureMusicKit()
      },
      retry: {
        onRetry: ({ attempt, delayMs, error }) =>
          this.emit('info', `${error.code} (deneme ${attempt}, ${delayMs} ms sonra)`)
      }
    })
  }

  private async loadSettings(): Promise<void> {
    try {
      await this.settings.load()
    } catch (err) {
      this.fail(err, 'Ayarlar okunamadı')
    }
  }

  /** 3.B3: ayarlar MusicKit'e ve EQ'ya anında uygulanır (başka pencereden gelen de). */
  private applySettings(): void {
    const s = this.settings.current
    if (!s) return
    try {
      applyPlaybackSettings(getMusicKit(), s)
    } catch {
      /* MusicKit henüz yapılandırılmadı: yapılandırılınca uygulanır */
    }
    this.eqBinding?.update(s.equalizer)
  }

  private async restore(): Promise<void> {
    try {
      const state = await restoreSession(ipcUserTokenStore, { syncStorefront: false })
      // R2: mağaza eşitlemesi (`music.me()`, ~0,8 sn) arka planda; kuyruk işlemleri onu bekler.
      if (state.restored) this.playerInstance?.holdQueueUntil(syncStorefront())
      this.signedInState = state.authorized
      this.emit('session', state)
      // R2: arayüz kuyruğu beklemez. Geri yükleme Apple'a 3–5 istek atar (şarkılar, otomatik çalma
      // istasyonu); ölçüm: açılışı ~2,5 sn uzatıyordu. Player kuyruk işlemlerini sıraya koyar ve
      // kullanıcının yeni isteği başlamamış geri yüklemeyi atlatır (player.ts `enqueueQueueOp`).
      if (state.authorized && this.playerInstance !== null) {
        const restored = await restorePlayerState(this.playerInstance, this.library, (err) =>
          this.fail(err, 'Kuyruk geri yüklenemedi')
        )
        if (restored) this.emit('queueRestored', undefined)
      }
    } catch (err) {
      this.fail(err, 'Oturum geri yüklenemedi')
    }
  }

  private attachPlayer(): void {
    if (this.playerInstance) return
    const beforePlayback = async (): Promise<void> => {
      if (this.cdm.status.state === 'pending') {
        this.emit('info', 'Widevine CDM hazırlanıyor; çalma CDM hazır olunca başlayacak…')
      }
      await this.cdm.waitUntilReady()
    }
    const p = new Player(undefined, { beforePlayback })
    this.playerInstance = p
    bindMediaSession(p)
    persistPlayerState(p, this.library, {
      onError: (err) => this.fail(err, 'Player durumu kaydedilemedi')
    })
    this.eqBinding = bindEqualizer(
      p,
      this.equalizer,
      (this.settings.current ?? defaultSettings()).equalizer
    )
    // 1.8a: durum main'deki player-hub üzerinden tüm pencerelere yayınlanır, komutlar oradan gelir.
    connectPlayerToHub(p, ipcHubPort)
    // 3.A7: kuyruktaki sıradaki şarkının arka planı düşük öncelikle ön yüklenir.
    connectBackgroundPrefetch(p, this.background, {
      lang: () => i18n.locale,
      onError: (err) => this.emit('info', `Arka plan ön yüklemesi: ${err.code}`)
    })
    this.emit('playerReady', p)
  }

  /** PLAN 2.3: uykudan uyanınca / ağ geri gelince MusicKit, developer token ve kütüphane denetlenir. */
  private watchReconnect(): void {
    onReconnect({ onSystemResume: window.api.onSystemResume, window }, (reason) => {
      this.emit(
        'info',
        `Yeniden bağlanma (${reason === 'resume' ? 'uykudan uyandı' : 'ağ geldi'})…`
      )
      void refreshAfterReconnect({
        isMusicKitLoaded: () => window.MusicKit !== undefined && musicKitConfiguredAt() !== null,
        loadMusicKit: () => this.startMusicKit(),
        configuredAt: musicKitConfiguredAt,
        reconfigure: reconfigureMusicKit,
        flushPendingWrites: () => this.library.flushPendingWrites(),
        syncLibrary: () => this.library.sync({ scope: 'playlists' })
      }).then((done) => this.emit('reconnected', done))
    })
  }

  private fail(err: unknown, context: string): void {
    this.emit('error', { error: toCoreError(err, 'UNKNOWN', context), context })
  }
}
