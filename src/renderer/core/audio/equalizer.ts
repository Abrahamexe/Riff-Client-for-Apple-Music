import { EQ_BANDS_HZ, findPreset, type EqualizerSettings } from '@shared/settings'
import type { Player } from '../musickit/player'

// Ekolayzır (PLAN 3.B3). MusicKit'in <audio> öğesi Web Audio'ya bağlanır:
//   kaynak → preamp (Gain) → 10 × peaking Biquad (32 Hz … 16 kHz) → çıkış
// Fizibilite (MANUAL_TESTS 3.B3): Widevine korumalı ses grafiğe sessizleşmeden geliyor; filtreler ve
// preamp etkili; `music.volume` grafikten önce uygulanır (ses kontrolü EQ'dan bağımsız).
// Kurallar:
//  - EQ hiç açılmadıysa grafik KURULMAZ (ses yolu MusicKit'inkiyle aynı kalır).
//  - Bir öğeye `createMediaElementSource` yalnızca bir kez bağlanabilir; bağlanan öğeler tutulur.
//    Grafik kurulduktan sonra EQ kapatılırsa kazançlar nötr (0 dB) yapılır — öğe sökülemez.
//  - Şarkıya özel hazır ayar (Apple: Özellikler → Seçenekler → Ekolayzır) genel ayarı geçersiz kılar.

/** Bir oktav genişliğinde tepe filtresi (10 bantlı grafik EQ için). */
const BAND_Q = 1.41

export interface ParamLike {
  value: number
}
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
}
export interface GainNodeLike extends AudioNodeLike {
  gain: ParamLike
}
export interface BiquadNodeLike extends AudioNodeLike {
  type: string
  frequency: ParamLike
  Q: ParamLike
  gain: ParamLike
}
/** Ses düzeyi ölçümü (büyük oynatıcının "müzikle nabız" arka planı). */
export interface AnalyserLike extends AudioNodeLike {
  fftSize: number
  getByteTimeDomainData(array: Uint8Array): void
}
/** `AudioContext`'in kullandığımız yüzeyi (testte sahtesi verilir). */
export interface AudioContextLike {
  readonly state: string
  readonly destination: AudioNodeLike
  createMediaElementSource(element: HTMLMediaElement): AudioNodeLike
  createGain(): GainNodeLike
  createBiquadFilter(): BiquadNodeLike
  createAnalyser?(): AnalyserLike
  resume(): Promise<void>
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

export class Equalizer {
  private ctx: AudioContextLike | null = null
  private preamp: GainNodeLike | null = null
  private bands: BiquadNodeLike[] = []
  private analyser: AnalyserLike | null = null
  private samples: Uint8Array | null = null
  private readonly attached = new WeakSet<HTMLMediaElement>()

  constructor(private readonly createContext: () => AudioContextLike = () => new AudioContext()) {}

  get active(): boolean {
    return this.ctx !== null
  }

  /** Öğeyi grafiğe bağlar (gerekirse grafiği kurar). Aynı öğe ikinci kez bağlanmaz. */
  attach(element: HTMLMediaElement): void {
    if (this.attached.has(element)) return
    const ctx = this.ensureGraph()
    ctx.createMediaElementSource(element).connect(this.preamp!)
    this.attached.add(element)
  }

  /** dB değerleri; `null` = nötr (EQ kapalı). Grafik yoksa bir şey yapmaz. */
  setGains(values: { preamp: number; bands: readonly number[] } | null): void {
    if (!this.ctx) return
    this.preamp!.gain.value = values ? dbToGain(values.preamp) : 1
    this.bands.forEach((b, i) => (b.gain.value = values ? (values.bands[i] ?? 0) : 0))
  }

  /**
   * Büyük oynatıcı (2026-10-14, "müzikle nabız"): medya öğelerini grafiğe bağlar ki ses düzeyi
   * ölçülebilsin. EQ kapalıysa kazançlar nötr kalır (ses değişmez); öğe bir kez bağlanır.
   */
  startAnalysis(elements: readonly HTMLMediaElement[]): void {
    for (const el of elements) this.attach(el)
    void this.resume().catch(() => {})
  }

  /** Anlık ses düzeyi 0..1 (RMS, müzik için ölçekli); grafik / analizci yoksa 0. */
  level(): number {
    if (!this.analyser) return 0
    this.samples ??= new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(this.samples)
    let sum = 0
    for (const v of this.samples) {
      const x = (v - 128) / 128
      sum += x * x
    }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 2.5)
  }

  /** Tarayıcı AudioContext'i kullanıcı etkileşimi/çalma öncesi askıda başlatabilir. */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
  }

  private ensureGraph(): AudioContextLike {
    if (this.ctx) return this.ctx
    const ctx = this.createContext()
    const preamp = ctx.createGain()
    let node: AudioNodeLike = preamp
    this.bands = EQ_BANDS_HZ.map((hz) => {
      const band = ctx.createBiquadFilter()
      band.type = 'peaking'
      band.frequency.value = hz
      band.Q.value = BAND_Q
      band.gain.value = 0
      node.connect(band)
      node = band
      return band
    })
    node.connect(ctx.destination)
    // Yalnızca dinleyen dal: çıkışa bağlanmaz, sesi değiştirmez.
    if (ctx.createAnalyser) {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      node.connect(analyser)
      this.analyser = analyser
    }
    this.ctx = ctx
    this.preamp = preamp
    return ctx
  }
}

/** Ayarlar + çalan şarkı → uygulanacak dB değerleri (`null` = EQ kapalı). */
export function effectiveGains(
  eq: EqualizerSettings,
  catalogId: string | undefined
): { preamp: number; bands: readonly number[] } | null {
  if (!eq.enabled) return null
  const songPresetId = catalogId ? eq.songPresets[catalogId] : undefined
  const songPreset = songPresetId ? findPreset(eq, songPresetId) : null
  return songPreset ?? { preamp: eq.preamp, bands: eq.bands }
}

export interface EqualizerBinding {
  /** Ayar değişti (SettingsClient.onChange). */
  update(eq: EqualizerSettings): void
  dispose(): void
}

/**
 * Player'a bağlar: çalma başlayınca (EQ açıksa) MusicKit'in medya öğeleri grafiğe eklenir, çalan şarkı
 * değişince şarkıya özel ayar uygulanır. `findMedia`: MusicKit'in <audio> öğeleri.
 */
export function bindEqualizer(
  player: Pick<Player, 'on'>,
  equalizer: Equalizer,
  initial: EqualizerSettings,
  findMedia: () => HTMLMediaElement[] = () => [...document.querySelectorAll('audio')]
): EqualizerBinding {
  let eq = initial
  let catalogId: string | undefined
  let playing = false

  const apply = (): void => {
    const gains = effectiveGains(eq, catalogId)
    // Grafik yalnızca EQ açıkken ve ortada çalan bir öğe varken kurulur.
    if (gains && playing) {
      for (const el of findMedia()) equalizer.attach(el)
      void equalizer.resume().catch(() => {})
    }
    equalizer.setGains(gains)
  }

  const offs = [
    player.on('playbackStateDidChange', ({ state }) => {
      playing = state === 'playing'
      if (playing) apply()
    }),
    player.on('nowPlayingItemDidChange', (now) => {
      catalogId = now?.catalogId
      apply()
    })
  ]
  return {
    update(next) {
      eq = next
      apply()
    },
    dispose() {
      offs.forEach((off) => off())
    }
  }
}
