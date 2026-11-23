import { describe, expect, it } from 'vitest'
import { createErrorNoticeFilter, onlineTransition, REPEAT_WINDOW_MS } from './noticeRules'

describe('bildirimler (§3.4)', () => {
  it('iptal, geçersiz istek, oturum ve çevrimdışı hataları alttaki bildirime gitmez', () => {
    const notify = createErrorNoticeFilter(() => 0)
    for (const code of [
      'REQUEST_CANCELLED',
      'BG_CANCELLED',
      'INVALID_ARGUMENT',
      'UNAUTHORIZED',
      'OFFLINE'
    ]) {
      expect(notify(code), code).toBe(false)
    }
    expect(notify('PLAYBACK_STREAM_LIMIT')).toBe(true)
  })

  it('aynı hata kısa sürede tekrar gösterilmez; farklı hata gösterilir', () => {
    let t = 0
    const notify = createErrorNoticeFilter(() => t)
    expect(notify('PLAYBACK_FAILED')).toBe(true)
    t += REPEAT_WINDOW_MS - 1
    expect(notify('PLAYBACK_FAILED')).toBe(false)
    expect(notify('SERVER_ERROR')).toBe(true)
    t += 1
    expect(notify('PLAYBACK_FAILED')).toBe(true)
  })

  it('çevrimiçi geçişleri', () => {
    expect(onlineTransition(true, false)).toBe('lost')
    expect(onlineTransition(false, true)).toBe('restored')
    expect(onlineTransition(true, true)).toBeNull()
  })
})
