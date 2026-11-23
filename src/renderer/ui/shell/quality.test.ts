import { describe, expect, it } from 'vitest'
import { qualityInfo } from './quality'

describe('kalite rozeti', () => {
  it('akış ayarından AAC bit hızı', () => {
    expect(qualityInfo('high')).toEqual({
      badge: 'AAC 256',
      kbps: 256,
      nameKey: 'settings.playback.qualityHigh'
    })
    expect(qualityInfo('standard')).toEqual({
      badge: 'AAC 64',
      kbps: 64,
      nameKey: 'settings.playback.qualityStandard'
    })
  })
})
