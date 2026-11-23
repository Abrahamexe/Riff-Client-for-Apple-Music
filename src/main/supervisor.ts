import { CoreError, logError } from '@shared/errors'

// Çökme gözetimi (PLAN 2.3). Electron'a bağlı değildir; index.ts olayları buraya bağlar.
//  - Renderer (ana pencere) çökerse: pencere yeniden yüklenir; oturum ve kuyruk açılıştaki gibi
//    yerel DB'den geri gelir (PLAN 1.8). Worker çökerse: artan beklemeyle yeniden başlatılır ve bağlı
//    pencerelere yeni port verilir (worker-host.ts); bekleyen istekler WORKER_UNAVAILABLE ile biter.
//  - Kısa sürede tekrarlayan çökmede döngüye girilmez: sınır aşılınca GÜVENLİ MOD (arka plan katmanı
//    ve ön yükleme kapalı; en olası sorunlu yük) ve bir son deneme; o da çökerse otomatik yeniden
//    başlatma durur (kullanıcı uygulamayı yeniden açar).

export interface CrashPolicy {
  /** Bu süre içindeki çökmeler sayılır. */
  windowMs: number
  /** Pencere içinde bu kadar çökmeden sonra güvenli moda geçilir. */
  maxCrashes: number
  /** Güvenli modda da bu kadar çökerse otomatik yeniden başlatma durur. */
  maxSafeModeCrashes: number
}

const DEFAULT_CRASH_POLICY: CrashPolicy = {
  windowMs: 60_000,
  maxCrashes: 3,
  maxSafeModeCrashes: 2
}

export type CrashDecision = 'restart' | 'safeMode' | 'giveUp'

/** Bir bileşenin çökme geçmişi: kayan pencerede sayım. */
export class CrashLoopGuard {
  private crashes: number[] = []
  private safeModeCrashes: number[] = []
  private inSafeMode = false

  constructor(
    private readonly policy: CrashPolicy = DEFAULT_CRASH_POLICY,
    private readonly now: () => number = Date.now
  ) {}

  /** Bir çökmeyi kaydeder ve ne yapılacağını döner. */
  record(): CrashDecision {
    const t = this.now()
    this.crashes = this.crashes.filter((c) => t - c < this.policy.windowMs)
    this.crashes.push(t)
    if (this.inSafeMode) {
      // 2.7 D5: güvenli modda da yalnızca pencere içindeki çökmeler sayılır (saatler arayla iki
      // çökme otomatik yeniden başlatmayı kapatmaz).
      this.safeModeCrashes = this.safeModeCrashes.filter((c) => t - c < this.policy.windowMs)
      this.safeModeCrashes.push(t)
      return this.safeModeCrashes.length >= this.policy.maxSafeModeCrashes ? 'giveUp' : 'restart'
    }
    if (this.crashes.length > this.policy.maxCrashes) {
      this.inSafeMode = true
      return 'safeMode'
    }
    return 'restart'
  }

  get safeMode(): boolean {
    return this.inSafeMode
  }

  /** Pencere içindeki son çökme sayısına göre üstel bekleme (1, 2, 4 … sn; en fazla 30 sn). */
  backoffMs(): number {
    return Math.min(30_000, 1_000 * 2 ** Math.max(0, this.crashes.length - 1))
  }
}

/** Electron `render-process-gone` ayrıntısı (kullandığımız alanlar). */
export interface GoneDetails {
  reason: string
  exitCode?: number
}

export interface SupervisorDeps {
  reloadMainWindow(): void
  restartWorker(): void
  /** Güvenli mod: arka plan katmanı ve ön yükleme kapatılır (worker'a bildirilir). */
  enterSafeMode(): void
  schedule?: (fn: () => void, ms: number) => void
  now?: () => number
  policy?: CrashPolicy
}

/** Kasıtlı kapanış: çökme sayılmaz. */
const BENIGN_REASONS: ReadonlySet<string> = new Set(['clean-exit'])

export class Supervisor {
  private readonly renderer: CrashLoopGuard
  private readonly worker: CrashLoopGuard
  private readonly schedule: (fn: () => void, ms: number) => void
  private safeModeEntered = false

  constructor(private readonly deps: SupervisorDeps) {
    const now = deps.now ?? Date.now
    this.renderer = new CrashLoopGuard(deps.policy, now)
    this.worker = new CrashLoopGuard(deps.policy, now)
    this.schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms))
  }

  get safeMode(): boolean {
    return this.safeModeEntered
  }

  /** Ana pencerenin renderer süreci beklenmedik biçimde sonlandı. */
  onRendererGone(details: GoneDetails): void {
    if (BENIGN_REASONS.has(details.reason)) return
    const decision = this.renderer.record()
    this.report('renderer', decision, `${details.reason} (kod ${details.exitCode ?? '?'})`)
    if (decision === 'giveUp') return
    if (decision === 'safeMode') this.safeModeOnce()
    this.schedule(() => this.deps.reloadMainWindow(), this.renderer.backoffMs())
  }

  /** Worker süreci beklenmedik biçimde sonlandı (kasıtlı durdurma çağrılmaz). */
  onWorkerExit(code: number): void {
    const decision = this.worker.record()
    this.report('worker', decision, `kod ${code}`)
    if (decision === 'giveUp') return
    if (decision === 'safeMode') this.safeModeOnce()
    this.schedule(() => this.deps.restartWorker(), this.worker.backoffMs())
  }

  private safeModeOnce(): void {
    if (this.safeModeEntered) return
    this.safeModeEntered = true
    this.deps.enterSafeMode()
  }

  private report(component: string, decision: CrashDecision, detail: string): void {
    const action =
      decision === 'restart'
        ? 'yeniden başlatılıyor'
        : decision === 'safeMode'
          ? 'çökme döngüsü: güvenli mod (arka plan katmanı kapalı) ve yeniden başlatma'
          : 'çökme döngüsü sürüyor: otomatik yeniden başlatma durduruldu'
    logError(
      'supervisor',
      new CoreError(
        component === 'worker' ? 'WORKER_UNAVAILABLE' : 'RENDERER_CRASHED',
        `${component} çöktü: ${detail}; ${action}`
      )
    )
  }
}
