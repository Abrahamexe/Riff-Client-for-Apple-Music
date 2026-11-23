import { describe, expect, it, vi } from 'vitest'
import { PLAYBACK_WARMUP_ORIGINS } from '@shared/app-config'
import { createPlaybackWarmup } from './playbackWarmup'

describe('çalma bağlantısını ısıtma (main)', () => {
  it('yalnızca sabit Apple çalma origin’lerine; sıklık sınırlı', () => {
    let t = 0
    const preconnect = vi.fn()
    const warm = createPlaybackWarmup({ preconnect, now: () => t, minIntervalMs: 10_000 })
    expect(warm()).toBe(true)
    expect(preconnect.mock.calls.map((c) => c[0] as string)).toEqual([...PLAYBACK_WARMUP_ORIGINS])
    t = 9_999
    expect(warm()).toBe(false)
    t = 10_000
    expect(warm()).toBe(true)
    expect(preconnect).toHaveBeenCalledTimes(PLAYBACK_WARMUP_ORIGINS.length * 2)
    for (const o of PLAYBACK_WARMUP_ORIGINS) {
      expect(o).toMatch(/^https:\/\/[a-z-]+\.itunes\.apple\.com$/)
    }
  })
})
