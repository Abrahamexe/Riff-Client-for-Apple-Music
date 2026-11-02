import type { AudioLabSettings } from '@shared/settings'
import type { Player } from '../../musickit/player'
import type { AudioContextLike, Equalizer, ProcessorNodeLike } from '../equalizer'
import { LAB_PARAMS, LAB_PROCESSOR, type LabParamName } from './names'

// Ses Laboratuvarı bağlantısı (2026-10-30, CHECKPOINT §6.33). EQ ile aynı kurallar:
//  - Hiç açılmadıysa grafik kurulmaz, worklet yüklenmez (ses yolu MusicKit'inkiyle aynı).
//  - İlk açılışta (çalarken) MusicKit'in medya öğeleri grafiğe bağlanır, işlemci EQ'dan sonra eklenir.
//  - Kapatınca işlemci yerinde kalır ama tüm işlemler 0 / kapalı: çıkış girişin birebir kopyası.

/** Ayarlar → işlemci parametreleri (0..1). Kapalıyken hepsi 0: ses aynen geçer. */
export function labParams(lab: AudioLabSettings): Record<LabParamName, number> {
  if (!lab.enabled) return { clarity: 0, air: 0, limiter: 0 }
  return { clarity: lab.clarity / 100, air: lab.air / 100, limiter: lab.limiter ? 1 : 0 }
}

/** Gerçek işlemci: worklet modülünü yükler (bir kez) ve düğümü kurar. */
export function workletProcessor(moduleUrl: string) {
  return async (ctx: AudioContextLike): Promise<ProcessorNodeLike> => {
    const real = ctx as unknown as BaseAudioContext
    await real.audioWorklet.addModule(moduleUrl)
    return new AudioWorkletNode(real, LAB_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
  }
}

export interface AudioLabBinding {
  update(lab: AudioLabSettings): void
  dispose(): void
}

export function bindAudioLab(
  player: Pick<Player, 'on'>,
  equalizer: Pick<Equalizer, 'attach' | 'resume' | 'useProcessor'>,
  initial: AudioLabSettings,
  createProcessor: (ctx: AudioContextLike) => Promise<ProcessorNodeLike>,
  options: {
    findMedia?: () => HTMLMediaElement[]
    onError?: (err: unknown) => void
  } = {}
): AudioLabBinding {
  const findMedia = options.findMedia ?? (() => [...document.querySelectorAll('audio')])
  let lab = initial
  let playing = false
  let node: ProcessorNodeLike | null = null
  let loading = false

  const push = (): void => {
    if (!node) return
    const values = labParams(lab)
    for (const name of LAB_PARAMS) {
      const param = node.parameters.get(name)
      if (param) param.value = values[name]
    }
  }

  const apply = (): void => {
    if (lab.enabled && playing && !node && !loading) {
      for (const el of findMedia()) equalizer.attach(el)
      void equalizer.resume().catch(() => {})
      const pending = equalizer.useProcessor(createProcessor)
      if (pending) {
        loading = true
        pending
          .then((n) => {
            node = n
            push()
          })
          .catch((err: unknown) => options.onError?.(err))
          .finally(() => {
            loading = false
          })
      }
    }
    push()
  }

  const offs = [
    player.on('playbackStateDidChange', ({ state }) => {
      playing = state === 'playing'
      if (playing) apply()
    })
  ]
  return {
    update(next) {
      lab = next
      apply()
    },
    dispose() {
      offs.forEach((off) => off())
    }
  }
}
