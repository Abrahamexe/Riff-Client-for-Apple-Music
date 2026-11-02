import { describe, expect, it } from 'vitest'
import {
  biquadStep,
  exciter,
  exciterStep,
  highpass,
  labChain,
  limiter,
  limiterStep,
  midpointPeak,
  processBlock
} from './dsp'

const SR = 48_000
const sine = (hz: number, amp: number, n: number, phase = 0): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR + phase))
const rms = (a: ArrayLike<number>, from = 0): number => {
  let s = 0
  for (let i = from; i < a.length; i++) s += a[i]! ** 2
  return Math.sqrt(s / (a.length - from))
}
const peak = (a: ArrayLike<number>): number => {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!))
  return m
}

describe('highpass', () => {
  it('kesimin altını bastırır, üstünü geçirir', () => {
    const low = highpass(SR, 2500)
    const high = highpass(SR, 2500)
    const a = sine(100, 1, 4800).map((x) => biquadStep(low, x))
    const b = sine(10_000, 1, 4800).map((x) => biquadStep(high, x))
    expect(rms(a, 2400)).toBeLessThan(0.01)
    expect(rms(b, 2400)).toBeGreaterThan(0.65)
  })
})

describe('exciter', () => {
  it('miktar 0 iken hiçbir şey eklemez', () => {
    const e = exciter(SR, 2500, 2.2, 0.5)
    for (const x of sine(5000, 0.8, 1000)) expect(Math.abs(exciterStep(e, x, 0))).toBe(0)
  })

  it('alt frekanslara dokunmaz, tizde harmonik ekler (sınırlı düzeyde)', () => {
    const lowE = exciter(SR, 2500, 2.2, 0.5)
    const highE = exciter(SR, 2500, 2.2, 0.5)
    const low = sine(150, 0.9, 9600).map((x) => exciterStep(lowE, x, 1))
    const high = sine(4000, 0.9, 9600).map((x) => exciterStep(highE, x, 1))
    expect(rms(low, 4800)).toBeLessThan(0.005)
    expect(rms(high, 4800)).toBeGreaterThan(0.005)
    expect(peak(high)).toBeLessThan(0.5)
  })
})

describe('limiter', () => {
  it('yüksek sinyal tavanı (−1 dB) asla aşmaz', () => {
    const l = limiter(SR, 2)
    const loud = sine(1000, 2, 9600)
    let max = 0
    const frame = new Float32Array(2)
    for (const x of loud) {
      frame[0] = x
      frame[1] = -x
      limiterStep(l, frame)
      max = Math.max(max, Math.abs(frame[0]), Math.abs(frame[1]))
    }
    expect(max).toBeLessThanOrEqual(l.ceiling + 1e-6)
  })

  it('sessiz sinyal yalnızca gecikir, değişmez', () => {
    const l = limiter(SR, 1)
    const input = sine(440, 0.3, 2000)
    const out: number[] = []
    const frame = new Float32Array(1)
    for (const x of input) {
      frame[0] = x
      limiterStep(l, frame)
      out.push(frame[0])
    }
    for (let i = 500; i < 2000; i++) expect(out[i]).toBeCloseTo(input[i - l.lookahead]!, 5)
  })

  it('örnekler arası tepeyi yakalar (örnekler tavanın altında, gerçek tepe üstünde)', () => {
    // fs/4 sinüs 45° fazla: örnekler ±0,707·A, gerçek tepe A.
    const a = 1.05
    const s = sine(SR / 4, a, 8, Math.PI / 4)
    expect(peak(s)).toBeLessThan(0.891)
    // Tepe s[4] ile s[5] arasında (ikisi de +0,707·A).
    expect(midpointPeak(s[3]!, s[4]!, s[5]!, s[6]!)).toBeGreaterThan(0.891)
  })
})

describe('processBlock', () => {
  it('her şey kapalıyken ses aynen geçer', () => {
    const chain = labChain(SR, 2)
    const l = sine(440, 0.5, 128)
    const r = sine(660, 0.5, 128)
    const left = Float32Array.from(l)
    const right = Float32Array.from(r)
    processBlock(chain, [left, right], { clarity: 0, air: 0, limiter: false })
    expect([...left]).toEqual([...l])
    expect([...right]).toEqual([...r])
  })

  it('tam açıkken bile çıkış tavanı aşmaz', () => {
    const chain = labChain(SR, 2)
    let max = 0
    for (let b = 0; b < 100; b++) {
      const left = sine(6000, 1, 128, b)
      const right = sine(9000, 1, 128, b)
      processBlock(chain, [left, right], { clarity: 1, air: 1, limiter: true })
      max = Math.max(max, peak(left), peak(right))
    }
    expect(max).toBeLessThanOrEqual(chain.limiter.ceiling + 1e-6)
  })

  it('gerçek zamanda rahat çalışır (1 sn stereo, tüm işlemler açık)', () => {
    const chain = labChain(SR, 2)
    const blocks = SR / 128
    const left = new Float32Array(128)
    const right = new Float32Array(128)
    const t0 = performance.now()
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < 128; i++) {
        left[i] = Math.sin(i + b)
        right[i] = Math.cos(i + b)
      }
      processBlock(chain, [left, right], { clarity: 0.5, air: 0.5, limiter: true })
    }
    // 1000 ms'lik sesi işlemek bunun çok altında sürmeli (CPU payı).
    expect(performance.now() - t0).toBeLessThan(250)
  })
})
