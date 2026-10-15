import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_RETRY_DELAY_MS, watchLoadFailures, type LoadFailureSource } from './auth-window'

const SECRET = 'eyJTRUNSRVQiOiJ0b2tlbiJ9'
const URL_WITH_TOKEN = `https://authorize.music.apple.com/woa?a=${SECRET}&app=music`

function fakeContents(): LoadFailureSource & EventEmitter & { reload: ReturnType<typeof vi.fn> } {
  const ee = new EventEmitter() as EventEmitter & {
    reload: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
  }
  ee.reload = vi.fn()
  ee.isDestroyed = () => false
  return ee as never
}

describe('watchLoadFailures (giriş penceresi)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('geçici ağ hatası: maskeli loglar ve bir kez yeniler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const contents = fakeContents()
    const schedule = vi.fn((fn: () => void) => fn())
    watchLoadFailures(contents, schedule)

    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', URL_WITH_TOKEN, true)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), AUTH_RETRY_DELAY_MS)
    expect(contents.reload).toHaveBeenCalledTimes(1)

    // İkinci hata: yeniden denenmez (döngü yok).
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', URL_WITH_TOKEN, true)
    expect(contents.reload).toHaveBeenCalledTimes(1)

    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('AUTH_003')
    expect(logged).toContain('https://authorize.music.apple.com/woa')
    expect(logged).not.toContain(SECRET)
  })

  it('kalıcı hata yenilenmez; alt çerçeve ve iptal (ERR_ABORTED) yoksayılır', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const contents = fakeContents()
    const schedule = vi.fn()
    watchLoadFailures(contents, schedule)

    contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', URL_WITH_TOKEN, true)
    contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', URL_WITH_TOKEN, false)
    expect(warn).not.toHaveBeenCalled()

    contents.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', URL_WITH_TOKEN, true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('pencere kapandıysa yenilemez', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const contents = fakeContents()
    contents.isDestroyed = () => true
    watchLoadFailures(contents, (fn) => fn())
    contents.emit('did-fail-load', {}, -106, 'ERR_INTERNET_DISCONNECTED', URL_WITH_TOKEN, true)
    expect(contents.reload).not.toHaveBeenCalled()
  })
})
