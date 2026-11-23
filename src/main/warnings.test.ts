import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installWarningRedaction, redactUrlsInText } from './warnings'

// V3'te gözlenen gerçek uyarının biçimi; `a=` parametresi developer token'ı (base64) taşır.
const SECRET = 'eyJ0aGlyZFBhcnR5VG9rZW4iOiJTRUNSRVQifQ%3D%3D'
const ELECTRON_WARNING = `Failed to load URL: https://authorize.music.apple.com/woa?a=${SECRET}&referrer=app%3A%2F%2Frenderer%2Findex.html&app=music#frag with error: ERR_NAME_NOT_RESOLVED`

describe('redactUrlsInText', () => {
  it('URL sorgusunu ve fragment’ı atar, metnin kalanını korur', () => {
    const out = redactUrlsInText(ELECTRON_WARNING)
    expect(out).toBe(
      'Failed to load URL: https://authorize.music.apple.com/woa with error: ERR_NAME_NOT_RESOLVED'
    )
    expect(out).not.toContain(SECRET)
  })

  it('birden çok URL ve tırnak içindeki URL', () => {
    const out = redactUrlsInText(`a 'https://x.apple.com/p?t=1' b app://renderer/index.html?k=2`)
    expect(out).toBe(`a 'https://x.apple.com/p' b app://renderer/index.html`)
  })

  it('URL olmayan metne dokunmaz', () => {
    expect(redactUrlsInText('MaxListenersExceededWarning: 11 listeners')).toBe(
      'MaxListenersExceededWarning: 11 listeners'
    )
  })
})

describe('installWarningRedaction', () => {
  it('varsayılan yazıcıyı kaldırır; uyarıyı redaksiyonla yazar', () => {
    const proc = new EventEmitter()
    const defaultPrinter = vi.fn()
    proc.on('warning', defaultPrinter)
    const write = vi.fn()

    installWarningRedaction(proc, write)
    const warning = new Error(ELECTRON_WARNING)
    warning.name = 'electron'
    proc.emit('warning', warning)

    expect(defaultPrinter).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledTimes(1)
    const line = write.mock.calls[0]![0] as string
    expect(line).toContain('electron: Failed to load URL: https://authorize.music.apple.com/woa')
    expect(line).not.toContain(SECRET)
  })
})
