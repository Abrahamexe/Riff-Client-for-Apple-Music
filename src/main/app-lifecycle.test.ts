import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLifecycle } from './app-lifecycle'
import { I18n } from '@shared/i18n'
import { trayMenuTemplate } from './platform/tray'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const event = () => ({ preventDefault: vi.fn() })
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

describe('AppLifecycle (1.8a)', () => {
  it('varsayılan (V6 kararı): X uygulamadan çıkar; çıkış pencere kapanmadan başlatılır', () => {
    const quit = vi.fn()
    const lc = new AppLifecycle({ quit, flush: async () => {} })
    expect(lc.closeBehavior).toBe('quit')
    const e = event()
    const hide = vi.fn()
    lc.onMainWindowClose(e, hide)
    // Pencere hemen kapanmaz: önce before-quit → flush (player durumu) → çıkış.
    expect(e.preventDefault).toHaveBeenCalled()
    expect(quit).toHaveBeenCalledTimes(1)
    expect(lc.quitting).toBe(true)
    expect(hide).not.toHaveBeenCalled()

    // Çıkış sırasında gelen kapatma olayı engellenmez.
    const e2 = event()
    lc.onMainWindowClose(e2, hide)
    expect(e2.preventDefault).not.toHaveBeenCalled()
  })

  it('isteğe bağlı "gizle": X pencereyi gizler; çıkılıyorsa kapanır', () => {
    const lc = new AppLifecycle({ quit: vi.fn(), flush: async () => {}, closeBehavior: 'hide' })
    const e = event()
    const hide = vi.fn()
    lc.onMainWindowClose(e, hide)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(hide).toHaveBeenCalled()

    lc.requestQuit()
    const e2 = event()
    lc.onMainWindowClose(e2, vi.fn())
    expect(e2.preventDefault).not.toHaveBeenCalled()
  })

  it('before-quit: önce kayıt (flush) beklenir, sonra çıkış tekrarlanır', async () => {
    const order: string[] = []
    const quit = vi.fn(() => order.push('quit'))
    const lc = new AppLifecycle({ quit, flush: async () => void order.push('flush') })
    const first = event()
    lc.onBeforeQuit(first)
    expect(first.preventDefault).toHaveBeenCalled()
    expect(lc.quitting).toBe(true)
    // Flush sürerken gelen ikinci before-quit yeni bir flush başlatmaz.
    lc.onBeforeQuit(event())
    await flushMicrotasks()
    expect(order).toEqual(['flush', 'quit'])
    // Tekrarlanan çıkış artık engellenmez.
    const again = event()
    lc.onBeforeQuit(again)
    expect(again.preventDefault).not.toHaveBeenCalled()
  })

  it('flush takılırsa süre dolunca yine çıkılır; hata verirse loglanıp çıkılır', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const lc = new AppLifecycle({ quit, flush: () => new Promise(() => {}), flushTimeoutMs: 500 })
    lc.onBeforeQuit(event())
    await vi.advanceTimersByTimeAsync(499)
    expect(quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(quit).toHaveBeenCalledTimes(1)
    vi.useRealTimers()

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const quit2 = vi.fn()
    const failing = new AppLifecycle({ quit: quit2, flush: () => Promise.reject(new Error('db')) })
    failing.onBeforeQuit(event())
    await flushMicrotasks()
    expect(quit2).toHaveBeenCalledTimes(1)
  })

  it('sistem kapanışı (session-end): çıkış bayrağı + en iyi çabayla kayıt', async () => {
    const flush = vi.fn(async () => {})
    const lc = new AppLifecycle({ quit: vi.fn(), flush })
    lc.onSessionEnd()
    expect(lc.quitting).toBe(true)
    const e = event()
    lc.onMainWindowClose(e, vi.fn())
    expect(e.preventDefault).not.toHaveBeenCalled()
    await flushMicrotasks()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('tray menüsü', () => {
  it('etiketler i18n’den gelir ve eylemler doğru komutları gönderir', () => {
    const actions = { show: vi.fn(), command: vi.fn(), quit: vi.fn() }
    const i18n = new I18n(['tr-TR'])
    const items = trayMenuTemplate(i18n, actions)
    const byLabel = (label: string) => items.find((i) => i.label === label)!
    expect(items.map((i) => i.label).filter(Boolean)).toEqual([
      'Pencereyi göster',
      'Çal / Duraklat',
      'Önceki şarkı',
      'Sonraki şarkı',
      'Çıkış'
    ])
    const click = (label: string) => (byLabel(label).click as () => void)()
    click('Çal / Duraklat')
    click('Çıkış')
    click('Pencereyi göster')
    expect(actions.command).toHaveBeenCalledWith({ type: 'togglePlay' })
    expect(actions.quit).toHaveBeenCalled()
    expect(actions.show).toHaveBeenCalled()

    i18n.setPreference('en')
    expect(trayMenuTemplate(i18n, actions).at(-1)?.label).toBe('Quit')
  })
})
