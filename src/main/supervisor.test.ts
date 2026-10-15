import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrashLoopGuard, Supervisor } from './supervisor'

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

const policy = { windowMs: 60_000, maxCrashes: 3, maxSafeModeCrashes: 2 }

describe('CrashLoopGuard', () => {
  it('pencere içinde sınır aşılınca güvenli mod, orada da tekrarlarsa vazgeçer', () => {
    const clock = { t: 0 }
    const g = new CrashLoopGuard(policy, () => clock.t)
    expect([g.record(), g.record(), g.record()]).toEqual(['restart', 'restart', 'restart'])
    expect(g.record()).toBe('safeMode')
    expect(g.safeMode).toBe(true)
    expect(g.record()).toBe('restart')
    expect(g.record()).toBe('giveUp')
  })

  it('güvenli modda saatler arayla gelen çökmeler vazgeçirmez (2.7 D5)', () => {
    const clock = { t: 0 }
    const g = new CrashLoopGuard(policy, () => clock.t)
    for (let i = 0; i < 4; i++) g.record()
    expect(g.safeMode).toBe(true)
    clock.t += 3_600_000
    expect(g.record()).toBe('restart')
    clock.t += 3_600_000
    expect(g.record()).toBe('restart')
  })

  it('pencere dışındaki eski çökmeler sayılmaz; bekleme üstel ve sınırlı', () => {
    const clock = { t: 0 }
    const g = new CrashLoopGuard(policy, () => clock.t)
    g.record()
    expect(g.backoffMs()).toBe(1_000)
    g.record()
    expect(g.backoffMs()).toBe(2_000)
    clock.t += 61_000
    expect(g.record()).toBe('restart')
    expect(g.backoffMs()).toBe(1_000)
  })
})

describe('Supervisor (2.3)', () => {
  function setup() {
    const clock = { t: 0 }
    const deps = {
      reloadMainWindow: vi.fn(),
      restartWorker: vi.fn(),
      enterSafeMode: vi.fn(),
      schedule: vi.fn<(fn: () => void, ms: number) => void>((fn) => fn()),
      now: () => clock.t,
      policy
    }
    return { sup: new Supervisor(deps), deps, clock }
  }

  it('renderer çökmesi: pencere yeniden yüklenir; kasıtlı kapanış yoksayılır', () => {
    const { sup, deps } = setup()
    sup.onRendererGone({ reason: 'clean-exit', exitCode: 0 })
    expect(deps.reloadMainWindow).not.toHaveBeenCalled()
    sup.onRendererGone({ reason: 'crashed', exitCode: -1 })
    expect(deps.reloadMainWindow).toHaveBeenCalledTimes(1)
    expect(deps.schedule).toHaveBeenLastCalledWith(expect.any(Function), 1_000)
  })

  it('worker çökmesi: artan beklemeyle yeniden başlatılır', () => {
    const { sup, deps } = setup()
    sup.onWorkerExit(1)
    sup.onWorkerExit(1)
    expect(deps.restartWorker).toHaveBeenCalledTimes(2)
    expect(deps.schedule.mock.calls.map((c) => c[1])).toEqual([1_000, 2_000])
  })

  it('çökme döngüsü: bir kez güvenli mod, sonra otomatik yeniden başlatma durur', () => {
    const { sup, deps } = setup()
    for (let i = 0; i < 4; i++) sup.onWorkerExit(1)
    expect(deps.enterSafeMode).toHaveBeenCalledTimes(1)
    expect(sup.safeMode).toBe(true)
    expect(deps.restartWorker).toHaveBeenCalledTimes(4)
    sup.onWorkerExit(1) // güvenli modda 1.
    sup.onWorkerExit(1) // güvenli modda 2. → vazgeç
    expect(deps.restartWorker).toHaveBeenCalledTimes(5)
    // Renderer döngüsü güvenli moda ayrıca girmez (tek sefer).
    for (let i = 0; i < 4; i++) sup.onRendererGone({ reason: 'crashed' })
    expect(deps.enterSafeMode).toHaveBeenCalledTimes(1)
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(logged).toContain('WRK_001')
    expect(logged).toContain('WIN_001')
  })
})
