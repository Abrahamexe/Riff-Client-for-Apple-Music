import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/settings'
import { applyTweaks, motionConfigMode, stepVolume } from './tweaks'

function fakeRoot() {
  const classes = new Set<string>()
  const vars = new Map<string, string>()
  return {
    classList: {
      toggle: (name: string, force: boolean) => (force ? classes.add(name) : classes.delete(name))
    },
    style: { setProperty: (n: string, v: string) => void vars.set(n, v) },
    classes,
    vars
  }
}

describe('ince ayarın köke uygulanması', () => {
  it('varsayılanda sınıf yok, söz ölçeği 1', () => {
    const root = fakeRoot()
    applyTweaks(root, defaultSettings().tweaks)
    expect([...root.classes]).toEqual([])
    expect(root.vars.get('--lyrics-scale')).toBe('1')
  })

  it('azaltılmış animasyon, bulanıklık kapalı, büyük söz', () => {
    const root = fakeRoot()
    const tweaks = { ...defaultSettings().tweaks }
    applyTweaks(root, { ...tweaks, motion: 'reduced', glassBlur: false, lyricsSize: 'large' })
    expect([...root.classes].sort()).toEqual(['tw-no-blur', 'tw-reduced-motion'])
    expect(root.vars.get('--lyrics-scale')).toBe('1.25')
    applyTweaks(root, tweaks)
    expect([...root.classes]).toEqual([])
  })

  it('Motion kipi ve ses adımı', () => {
    expect(motionConfigMode('system')).toBe('user')
    expect(motionConfigMode('reduced')).toBe('always')
    expect(motionConfigMode('full')).toBe('never')
    expect(stepVolume(0.5, 5, true)).toBe(0.55)
    expect(stepVolume(0.98, 10, true)).toBe(1)
    expect(stepVolume(0.03, 5, false)).toBe(0)
  })
})
