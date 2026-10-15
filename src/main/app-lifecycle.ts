import { logError } from '@shared/errors'

// Uygulama yaşam döngüsü (PLAN 1.8a; V6 geliştirici kararı, 2026-10-12):
//  - Varsayılan: ana pencerenin Kapat (X) düğmesi uygulamadan ÇIKAR (Spotify / Apple Music gibi);
//    simge durumuna küçültme (−) pencereyi görev çubuğuna alır, çalma sürer.
//  - İsteğe bağlı "kapatınca gizle" (`hide`, ayar Faz 3.B3): X pencereyi tray'e gizler; gerçek çıkış
//    tray "Çıkış", uygulama menüsü veya sistem kapanışıyla olur (`quitting`).
//  - Çıkıştan önce `flush` (son player durumunu kaydet) beklenir; süre sınırlıdır, takılırsa çıkılır.
// Electron'a bağımlı değildir (testlenebilir); index.ts olayları buraya bağlar.

export type CloseBehavior = 'hide' | 'quit'

export interface LifecycleOptions {
  /** `app.quit()`; flush bittikten sonra tekrar çağrılır. */
  quit: () => void
  /** Çıkıştan önce yapılacak iş (player durumu kaydı). Reddetse de çıkış sürer. */
  flush: () => Promise<void>
  flushTimeoutMs?: number
  closeBehavior?: CloseBehavior
}

interface PreventableEvent {
  preventDefault(): void
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2_000

export class AppLifecycle {
  private quittingFlag = false
  private flushed = false
  private flushing: Promise<void> | null = null
  private quitScheduled = false
  private behavior: CloseBehavior

  constructor(private readonly options: LifecycleOptions) {
    this.behavior = options.closeBehavior ?? 'quit'
  }

  get quitting(): boolean {
    return this.quittingFlag
  }

  /** "Kapatınca gizle / çık" tercihi (ayar altyapısı; kalıcı ayar Faz 3). */
  get closeBehavior(): CloseBehavior {
    return this.behavior
  }

  setCloseBehavior(behavior: CloseBehavior): void {
    this.behavior = behavior
  }

  /**
   * Ana pencerenin `close` olayı. Tercih "çık" ise pencere hemen kapanmaz: önce çıkış başlatılır,
   * böylece son player durumu ana pencere (ve hub'daki durumu) hâlâ varken kaydedilir; pencereler
   * çıkışta kapanır. Tercih "gizle" ise pencere gizlenir.
   */
  onMainWindowClose(event: PreventableEvent, hide: () => void): void {
    if (this.quittingFlag) return
    event.preventDefault()
    if (this.behavior === 'quit') this.requestQuit()
    else hide()
  }

  /** Kullanıcı açıkça çıkmak istedi (tray / menü). */
  requestQuit(): void {
    this.quittingFlag = true
    this.options.quit()
  }

  /**
   * Sistem kapanışı / oturum kapatma (Windows `session-end`): `before-quit` gelmeyebilir; pencere
   * kapatmaları engellenmez ve durum en iyi çabayla kaydedilir.
   */
  onSessionEnd(): void {
    this.quittingFlag = true
    void this.runFlush()
  }

  /** `before-quit`: ilk seferde çıkışı durdurur, flush'ı bekler, sonra çıkışı tekrarlar. */
  onBeforeQuit(event: PreventableEvent): void {
    this.quittingFlag = true
    if (this.flushed) return
    event.preventDefault()
    if (this.quitScheduled) return
    this.quitScheduled = true
    void this.runFlush().then(() => this.options.quit())
  }

  private runFlush(): Promise<void> {
    this.flushing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS)
      })
      try {
        await Promise.race([this.options.flush(), timeout])
      } catch (err) {
        logError('lifecycle', err, 'INTERNAL', 'Çıkış öncesi kayıt başarısız.')
      } finally {
        clearTimeout(timer)
        this.flushed = true
      }
    })()
    return this.flushing
  }
}
