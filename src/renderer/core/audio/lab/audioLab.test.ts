import { describe, expect, it, vi } from 'vitest'
import { defaultSettings, type AudioLabSettings } from '@shared/settings'
import { TypedEmitter } from '../../emitter'
import type { PlayerEvents } from '../../musickit/player'
import type { ProcessorNodeLike } from '../equalizer'
import { bindAudioLab, labParams } from './audioLab'

class FakePlayer extends TypedEmitter<PlayerEvents> {
  fire<K extends keyof PlayerEvents>(event: K, payload: PlayerEvents[K]): void {
    this.emit(event, payload)
  }
}

const lab = (over: Partial<AudioLabSettings> = {}): AudioLabSettings => ({
  ...defaultSettings().audioLab,
  ...over
})

function fakeNode() {
  const values: Record<string, { value: number }> = {
    clarity: { value: -1 },
    air: { value: -1 },
    limiter: { value: -1 }
  }
  const node: ProcessorNodeLike = { parameters: { get: (n) => values[n] }, connect: () => {} }
  return { node, values }
}

function setup(initial: AudioLabSettings) {
  const player = new FakePlayer()
  const { node, values } = fakeNode()
  const media = [{} as HTMLMediaElement]
  const equalizer = {
    attach: vi.fn(),
    resume: vi.fn(async () => {}),
    useProcessor: vi.fn(() => Promise.resolve(node))
  }
  const create = vi.fn(async () => node)
  const binding = bindAudioLab(player, equalizer, initial, create, { findMedia: () => media })
  return { player, equalizer, values, binding, media }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Ses Laboratuvarı bağlantısı', () => {
  it('varsayılan kapalı; kapalıyken parametreler 0 (ses aynen geçer)', () => {
    expect(defaultSettings().audioLab.enabled).toBe(false)
    expect(labParams(lab())).toEqual({ clarity: 0, air: 0, limiter: 0 })
    expect(labParams(lab({ enabled: true, clarity: 40, air: 10, limiter: true }))).toEqual({
      clarity: 0.4,
      air: 0.1,
      limiter: 1
    })
  })

  it('hiç açılmadıysa grafik kurulmaz, işlemci yüklenmez', async () => {
    const s = setup(lab())
    s.player.fire('playbackStateDidChange', { state: 'playing', previous: null })
    await flush()
    expect(s.equalizer.attach).not.toHaveBeenCalled()
    expect(s.equalizer.useProcessor).not.toHaveBeenCalled()
  })

  it('açıkken çalma başlayınca öğe bağlanır, işlemci eklenir, değerler uygulanır', async () => {
    const s = setup(lab({ enabled: true, clarity: 50, air: 20, limiter: true }))
    s.player.fire('playbackStateDidChange', { state: 'playing', previous: null })
    await flush()
    expect(s.equalizer.attach).toHaveBeenCalledWith(s.media[0])
    expect(s.equalizer.useProcessor).toHaveBeenCalledTimes(1)
    expect(s.values.clarity!.value).toBe(0.5)
    expect(s.values.air!.value).toBe(0.2)
    expect(s.values.limiter!.value).toBe(1)
  })

  it('ayarlardan kapatınca işlemci nötr olur; tekrar açınca değerler döner', async () => {
    const s = setup(lab({ enabled: true, clarity: 50 }))
    s.player.fire('playbackStateDidChange', { state: 'playing', previous: null })
    await flush()
    s.binding.update(lab({ enabled: false, clarity: 50 }))
    expect(s.values.clarity!.value).toBe(0)
    expect(s.values.limiter!.value).toBe(0)
    s.binding.update(lab({ enabled: true, clarity: 80 }))
    expect(s.values.clarity!.value).toBe(0.8)
    expect(s.equalizer.useProcessor).toHaveBeenCalledTimes(1)
  })

  it('çalmıyorken açılırsa çalma başlayınca kurulur', async () => {
    const s = setup(lab())
    s.binding.update(lab({ enabled: true }))
    expect(s.equalizer.useProcessor).not.toHaveBeenCalled()
    s.player.fire('playbackStateDidChange', { state: 'playing', previous: null })
    await flush()
    expect(s.equalizer.useProcessor).toHaveBeenCalledTimes(1)
  })
})
