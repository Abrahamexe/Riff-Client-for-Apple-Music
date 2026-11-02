import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThumbarButton } from 'electron'
import type { PlayerHubState } from '@shared/ipc-contract'
import { I18n } from '@shared/i18n'

const theme = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    shouldUseDarkColorsForSystemIntegratedUI: true,
    on: (_e: string, fn: () => void) => void listeners.add(fn),
    off: (_e: string, fn: () => void) => void listeners.delete(fn),
    fire: () => listeners.forEach((fn) => fn()),
    listeners
  }
})
vi.mock('electron', () => ({
  nativeTheme: theme,
  nativeImage: {
    createFromDataURL: (url: string) => ({ url, addRepresentation: vi.fn() })
  }
}))
const { setupThumbar, thumbarKey, thumbarSpec, thumbarTone } = await import('./thumbar')

const realPlatform = process.platform
function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
beforeEach(() => setPlatform('win32'))
afterEach(() => {
  setPlatform(realPlatform)
  theme.shouldUseDarkColorsForSystemIntegratedUI = true
})

const i18n = new I18n(['tr-TR'])
const NOW: NonNullable<PlayerHubState['nowPlaying']> = {
  id: 'i.1',
  title: 'Şarkı',
  artist: 'Sanatçı',
  album: 'Albüm',
  artworkUrl: null,
  durationSec: 1,
  playbackType: 'encryptedFull'
}
const state = (playbackState: PlayerHubState['playbackState'], track = true): PlayerHubState => ({
  playbackState,
  nowPlaying: track ? NOW : null,
  volume: 1,
  shuffle: false,
  repeat: 'none',
  queue: { ids: ['i.1'], position: 0, autoplayIndex: null }
})

describe('thumbarSpec', () => {
  it('önceki / çal-duraklat / sonraki; çalarken ortadaki "duraklat"', () => {
    const spec = thumbarSpec(i18n, state('playing'))
    expect(spec.map((b) => b.glyph)).toEqual(['previous', 'pause', 'next'])
    expect(spec.map((b) => b.command.type)).toEqual(['previous', 'togglePlay', 'next'])
    expect(spec[1]?.tooltip).toBe(i18n.t('player.pause'))
    expect(spec.every((b) => b.enabled)).toBe(true)
  })

  it('yüklenirken de duraklat gösterir (anında tepki); duraklatılmışta çal', () => {
    expect(thumbarSpec(i18n, state('loading'))[1]?.glyph).toBe('pause')
    expect(thumbarSpec(i18n, state('waiting'))[1]?.glyph).toBe('pause')
    expect(thumbarSpec(i18n, state('paused'))[1]?.glyph).toBe('play')
  })

  it('şarkı yoksa / oynatıcı hazır değilse düğmeler pasif', () => {
    expect(thumbarSpec(i18n, null).some((b) => b.enabled)).toBe(false)
    expect(thumbarSpec(i18n, state('none', false)).some((b) => b.enabled)).toBe(false)
  })

  it('koyu görev çubuğunda açık glif', () => {
    expect(thumbarTone(true)).toBe('light')
    expect(thumbarTone(false)).toBe('dark')
  })

  it('anahtar görünüm değişince değişir, aynı görünümde aynı kalır', () => {
    const a = thumbarKey(thumbarSpec(i18n, state('playing')), 'light')
    expect(thumbarKey(thumbarSpec(i18n, state('loading')), 'light')).toBe(a)
    expect(thumbarKey(thumbarSpec(i18n, state('paused')), 'light')).not.toBe(a)
    expect(thumbarKey(thumbarSpec(i18n, state('playing')), 'dark')).not.toBe(a)
  })
})

function fakeWindow() {
  const show: (() => void)[] = []
  const calls: ThumbarButton[][] = []
  return {
    calls,
    setThumbarButtons: (b: ThumbarButton[]) => (calls.push(b), true),
    isDestroyed: () => false,
    on: (_e: 'show', fn: () => void) => void show.push(fn),
    fireShow: () => show.forEach((fn) => fn())
  }
}

function fakeSource(initial: PlayerHubState | null) {
  let listener: ((s: PlayerHubState | null) => void) | null = null
  return {
    snapshot: () => ({ state: initial }),
    onState: (fn: (s: PlayerHubState | null) => void) => {
      listener = fn
      return () => void (listener = null)
    },
    emit: (s: PlayerHubState | null) => listener?.(s)
  }
}

describe('setupThumbar', () => {
  it('gösterilince kurar; yalnızca görünüm değişince yeniden gönderir; tıklama komut yollar', () => {
    const win = fakeWindow()
    const source = fakeSource(null)
    const command = vi.fn()
    const off = setupThumbar(win, i18n, source, command)
    win.fireShow()
    expect(win.calls).toHaveLength(1)
    expect(win.calls[0]?.every((b) => b.flags?.includes('disabled'))).toBe(true)

    source.emit(state('playing'))
    source.emit(state('playing')) // aynı görünüm: tekrar gönderilmez
    expect(win.calls).toHaveLength(2)
    expect(win.calls[1]?.[1]?.tooltip).toBe(i18n.t('player.pause'))
    win.calls[1]?.[2]?.click()
    expect(command).toHaveBeenCalledWith({ type: 'next' })

    theme.shouldUseDarkColorsForSystemIntegratedUI = false
    theme.fire()
    expect(win.calls).toHaveLength(3)

    off()
    expect(theme.listeners.size).toBe(0)
    source.emit(state('paused'))
    expect(win.calls).toHaveLength(3)
  })

  it('Windows dışında hiçbir şey yapmaz', () => {
    setPlatform('darwin')
    const win = fakeWindow()
    setupThumbar(win, i18n, fakeSource(state('playing')), vi.fn())
    win.fireShow()
    expect(win.calls).toHaveLength(0)
  })
})
