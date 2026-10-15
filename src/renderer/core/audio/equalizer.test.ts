import { describe, expect, it, vi } from 'vitest'
import { defaultSettings, EQ_BANDS_HZ, type EqualizerSettings } from '@shared/settings'
import { TypedEmitter } from '../emitter'
import type { PlayerEvents } from '../musickit/player'
import {
  bindEqualizer,
  dbToGain,
  effectiveGains,
  Equalizer,
  type AudioContextLike,
  type AudioNodeLike
} from './equalizer'

function fakeContext() {
  const edges: [string, string][] = []
  let n = 0
  const node = (kind: string, extra: object = {}) => {
    const name = `${kind}${n++}`
    const self = {
      name,
      ...extra,
      connect: (to: AudioNodeLike & { name?: string }) => void edges.push([name, to.name ?? '?'])
    }
    return self
  }
  const sources: HTMLMediaElement[] = []
  const ctx = {
    state: 'suspended',
    destination: { name: 'out', connect: () => {} },
    createMediaElementSource: vi.fn((el: HTMLMediaElement) => {
      sources.push(el)
      return node('src')
    }),
    createGain: () => node('gain', { gain: { value: 1 } }),
    createBiquadFilter: () =>
      node('bq', { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } }),
    resume: vi.fn(async () => {
      ctx.state = 'running'
    })
  }
  return { ctx: ctx as unknown as AudioContextLike & typeof ctx, edges, sources }
}

const eqWith = (over: Partial<EqualizerSettings>): EqualizerSettings => ({
  ...defaultSettings().equalizer,
  ...over
})

describe('Equalizer (3.B3)', () => {
  it('grafik: kaynak → preamp → 10 peaking bant (32 Hz…16 kHz) → çıkış; öğe bir kez bağlanır', () => {
    const fake = fakeContext()
    const eq = new Equalizer(() => fake.ctx)
    const el = {} as HTMLMediaElement
    eq.attach(el)
    eq.attach(el)
    expect(fake.ctx.createMediaElementSource).toHaveBeenCalledTimes(1)
    expect(fake.edges[0]).toEqual(['gain0', 'bq1'])
    expect(fake.edges.at(-2)).toEqual(['bq10', 'out'])
    expect(fake.edges.at(-1)).toEqual(['src11', 'gain0'])
  })

  it('kazançlar: dB → doğrusal preamp, bantlar dB; null → nötr', () => {
    const fake = fakeContext()
    const eq = new Equalizer(() => fake.ctx)
    eq.attach({} as HTMLMediaElement)
    const bands = EQ_BANDS_HZ.map((_, i) => i - 5)
    eq.setGains({ preamp: -6, bands })
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    eq.setGains(null)
    expect(dbToGain(0)).toBe(1)
  })

  it('etkin değerler: kapalı → null; şarkıya özel hazır ayar genel ayarı geçersiz kılar', () => {
    const preset = { id: 'gece', name: 'Gece', preamp: -2, bands: Array(10).fill(4) as number[] }
    const eq = eqWith({
      enabled: true,
      preamp: 1,
      bands: Array(10).fill(1) as number[],
      customPresets: [preset],
      songPresets: { '42': 'gece', '43': 'flat', '44': 'bass-boost' }
    })
    expect(effectiveGains({ ...eq, enabled: false }, '42')).toBeNull()
    expect(effectiveGains(eq, '42')).toMatchObject({ preamp: -2, bands: preset.bands })
    expect(effectiveGains(eq, '43')).toMatchObject({ preamp: 0, bands: Array(10).fill(0) })
    expect(effectiveGains(eq, '44')).toMatchObject({
      preamp: -6,
      bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]
    })
    expect(effectiveGains(eq, '99')).toEqual({ preamp: 1, bands: eq.bands })
  })
})

class FakePlayer extends TypedEmitter<PlayerEvents> {
  fire<K extends keyof PlayerEvents>(event: K, payload: PlayerEvents[K]): void {
    this.emit(event, payload)
  }
}

describe('bindEqualizer (3.B3)', () => {
  const setup = (initial: EqualizerSettings) => {
    const player = new FakePlayer()
    const fake = fakeContext()
    const equalizer = new Equalizer(() => fake.ctx)
    const el = {} as HTMLMediaElement
    const binding = bindEqualizer(player, equalizer, initial, () => [el])
    return { player, fake, equalizer, binding }
  }

  it('EQ kapalıyken çalmada grafik kurulmaz (ses yolu değişmez)', () => {
    const { player, fake, equalizer } = setup(eqWith({ enabled: false }))
    player.fire('playbackStateDidChange', { state: 'playing', previous: 'paused' })
    expect(equalizer.active).toBe(false)
    expect(fake.ctx.createMediaElementSource).not.toHaveBeenCalled()
  })

  it('açılınca çalan öğe bağlanır ve bağlam başlatılır; kapatılınca nötr kalır, sökülmez', () => {
    const { player, fake, equalizer, binding } = setup(eqWith({ enabled: false }))
    player.fire('playbackStateDidChange', { state: 'playing', previous: 'paused' })
    binding.update(eqWith({ enabled: true, preamp: -3 }))
    expect(equalizer.active).toBe(true)
    expect(fake.ctx.resume).toHaveBeenCalled()
    binding.update(eqWith({ enabled: false }))
    expect(equalizer.active).toBe(true)
    expect(fake.ctx.createMediaElementSource).toHaveBeenCalledTimes(1)
  })

  it('çalan şarkı değişince şarkıya özel ayar uygulanır; söküldükten sonra olay dinlenmez', () => {
    const spy = vi.spyOn(Equalizer.prototype, 'setGains')
    const preset = { id: 'p1', name: 'P', preamp: 5, bands: Array(10).fill(2) as number[] }
    const { player, binding } = setup(
      eqWith({ enabled: true, customPresets: [preset], songPresets: { '7': 'p1' } })
    )
    player.fire('playbackStateDidChange', { state: 'playing', previous: 'paused' })
    player.fire('nowPlayingItemDidChange', {
      id: 'i.x',
      catalogId: '7',
      title: '',
      artist: '',
      album: '',
      artworkTemplate: null,
      durationSec: 0,
      playbackType: 'encryptedFull'
    })
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ preamp: 5 }))
    binding.dispose()
    spy.mockClear()
    player.fire('nowPlayingItemDidChange', null)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('ses düzeyi analizi (büyük oynatıcı, 2026-10-14)', () => {
  it('analizci son banttan dinler, çıkışa bağlanmaz; düzey 0..1; grafik yoksa 0', () => {
    const fake = fakeContext()
    let wave = 128
    const analyser = {
      name: 'an',
      fftSize: 0,
      connect: vi.fn(),
      getByteTimeDomainData: (a: Uint8Array) => a.fill(wave)
    }
    const ctx = Object.assign(fake.ctx, { createAnalyser: () => analyser })
    const eq = new Equalizer(() => ctx)
    expect(eq.level()).toBe(0)
    eq.startAnalysis([{} as HTMLMediaElement])
    expect(fake.edges).toContainEqual(['bq10', 'an'])
    expect(analyser.connect).not.toHaveBeenCalled()
    expect(ctx.resume).toHaveBeenCalled()
    expect(eq.level()).toBe(0)
    wave = 160 // RMS 0.25 → ×2.5 → 0.625
    expect(eq.level()).toBeCloseTo(0.625, 3)
    wave = 255
    expect(eq.level()).toBe(1)
  })
})
