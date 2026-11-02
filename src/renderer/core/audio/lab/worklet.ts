// Ses Laboratuvarı AudioWorklet işlemcisi (ses iş parçacığında çalışır; ayrı paket: `?worker&url`).
// Yalnızca girişi işleyip çıkışa yazar; parametreler AudioParam ile gelir. `port` kullanılmaz: çözülmüş
// ses hiçbir yere gönderilmez (tests/guards/audio-lab.test.ts).

import { labChain, processBlock, type LabChain } from './dsp'
import { LAB_PARAMS, LAB_PROCESSOR } from './names'

// AudioWorkletGlobalScope (TS'in DOM kitaplığında yok).
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {}

class LabProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): object[] {
    return LAB_PARAMS.map((name) => ({
      name,
      defaultValue: 0,
      minValue: 0,
      maxValue: 1,
      automationRate: 'k-rate'
    }))
  }

  private chain: LabChain | null = null

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0)
      return true
    }
    for (let c = 0; c < output.length; c++) output[c]!.set(input[Math.min(c, input.length - 1)]!)
    if (this.chain?.frame.length !== output.length) this.chain = labChain(sampleRate, output.length)
    processBlock(this.chain, output, {
      clarity: params.clarity?.[0] ?? 0,
      air: params.air?.[0] ?? 0,
      limiter: (params.limiter?.[0] ?? 0) >= 0.5
    })
    return true
  }
}

registerProcessor(LAB_PROCESSOR, LabProcessor)
