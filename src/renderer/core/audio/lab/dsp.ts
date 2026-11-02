// Ses Laboratuvarı DSP çekirdeği (2026-10-30, CHECKPOINT §6.33). Saf, testli; AudioWorklet içinde
// (worklet.ts) 128 örneklik bloklarla çalışır. Yeni bağımlılık yok.
//
// Gerçekçi beklenti (geliştiriciye söylendi): kaynak 256 kbps AAC; atılan bilgi geri gelmez. Bu işlemler
// ALGIYI iyileştirir:
//  - Netlik: 2,5 kHz üstünü ayırıp hafif doyurur → orta-tizde harmonik, "net" ses (exciter).
//  - Hava: 9 kHz üstünü ayırıp doyurur → AAC'nin zayıflattığı en üst bölgede harmonik ("air").
//  - Kırpılma koruması: öngörülü (look-ahead) tepe sınırlayıcı; EQ/işlem yükseltince ya da örnekler
//    arası tepe (inter-sample) 0 dBFS'i aşınca oluşan cızırtıyı önler. Tavan −1 dBTP.
//
// Güvenlik: çözülmüş ses yalnızca bu fonksiyonlardan geçer ve çalma yoluna döner; hiçbir yere
// gönderilmez, saklanmaz (tests/guards ile denetlenir).

// ---- Biquad (RBJ Audio EQ Cookbook) ---------------------------------------------------------------

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
  // Durum (Direct Form I): son iki giriş ve çıkış.
  x1: number
  x2: number
  y1: number
  y2: number
}

/** 2. derece yüksek geçiren filtre. */
export function highpass(sampleRate: number, hz: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: (1 + cos) / 2 / a0,
    b1: -(1 + cos) / a0,
    b2: (1 + cos) / 2 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0
  }
}

export function biquadStep(f: Biquad, x: number): number {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2
  f.x2 = f.x1
  f.x1 = x
  f.y2 = f.y1
  // Çok küçük sayılar (denormal) işlemciyi yavaşlatmasın.
  f.y1 = Math.abs(y) < 1e-20 ? 0 : y
  return f.y1
}

// ---- Harmonik zenginleştirme (Netlik, Hava) -------------------------------------------------------

export interface Exciter {
  split: Biquad
  clean: Biquad
  drive: number
  /** Eklenen harmoniğin en yüksek düzeyi (amount = 1'de). */
  maxMix: number
}

/** `from` Hz üstünü ayırır, `drive` ile doyurur, yine `from` üstünü bırakır (alt bölgeye çamur yok). */
export function exciter(sampleRate: number, from: number, drive: number, maxMix: number): Exciter {
  return {
    split: highpass(sampleRate, from),
    clean: highpass(sampleRate, from),
    drive,
    maxMix
  }
}

/** Yumuşak doyurma (tanh), çıkış girişle aynı ölçekte; küçük sinyalde neredeyse doğrusal. */
export function saturate(x: number, drive: number): number {
  return Math.tanh(drive * x) / Math.tanh(drive)
}

/**
 * Bir örnek: eklenecek "harmonik" sinyal (girişe toplanır). Doyurulmuş bant ile doğrusal bandın farkı
 * yalnızca harmoniklerdir; böylece işlem tizleri yükseltmez, yalnızca harmonik ekler.
 */
export function exciterStep(e: Exciter, x: number, amount: number): number {
  const band = biquadStep(e.split, x)
  const harmonics = saturate(band * 2, e.drive) / 2 - band
  return biquadStep(e.clean, harmonics) * e.maxMix * amount
}

// ---- Öngörülü tepe sınırlayıcı --------------------------------------------------------------------

export interface Limiter {
  ceiling: number
  lookahead: number
  /** Gecikme hatları (kanal başına) ve yazma konumu. */
  delay: Float32Array[]
  pos: number
  /** Pencere içindeki en küçük hedef kazanç (monoton kuyruk: [konum, kazanç]). */
  queueAt: Int32Array
  queueGain: Float32Array
  head: number
  tail: number
  /** Örnek sayacı (kuyruk konumları için). */
  n: number
  gain: number
  attack: number
  release: number
  /** Son iki örnek (örnekler arası tepe tahmini için), kanal başına. */
  prev1: Float32Array
  prev2: Float32Array
  prev3: Float32Array
}

export const LIMITER_CEILING_DB = -1
const LOOKAHEAD_MS = 1.5
const RELEASE_MS = 80

export function limiter(
  sampleRate: number,
  channels: number,
  ceilingDb = LIMITER_CEILING_DB
): Limiter {
  const lookahead = Math.max(1, Math.round((sampleRate * LOOKAHEAD_MS) / 1000))
  const size = lookahead + 1
  return {
    ceiling: Math.pow(10, ceilingDb / 20),
    lookahead,
    delay: Array.from({ length: channels }, () => new Float32Array(size)),
    pos: 0,
    queueAt: new Int32Array(size + 1),
    queueGain: new Float32Array(size + 1),
    head: 0,
    tail: 0,
    n: 0,
    gain: 1,
    // Saldırı öngörü penceresi içinde ~%95'e varır; bırakma yavaş (pompalama yok).
    attack: 1 - Math.exp(-3 / lookahead),
    release: 1 - Math.exp(-1 / ((sampleRate * RELEASE_MS) / 1000)),
    prev1: new Float32Array(channels),
    prev2: new Float32Array(channels),
    prev3: new Float32Array(channels)
  }
}

/**
 * Örnekler arası tepe tahmini: son dört örnekten iki örnek arasının ortası (Catmull-Rom). D/A
 * dönüştürücüde sinyal örnek değerlerinden yüksek çıkabilir ("true peak"); bunu yakalar.
 */
export function midpointPeak(p0: number, p1: number, p2: number, p3: number): number {
  return Math.abs((-p0 + 9 * p1 + 9 * p2 - p3) / 16)
}

/** Tüm kanallarda bir örnek (yerinde): `frame[c]` giriş, dönüşte gecikmeli ve sınırlanmış çıkış. */
export function limiterStep(l: Limiter, frame: Float32Array | number[]): void {
  const channels = l.delay.length
  let peak = 0
  for (let c = 0; c < channels; c++) {
    const x = frame[c] ?? 0
    const mid = midpointPeak(l.prev3[c]!, l.prev2[c]!, l.prev1[c]!, x)
    peak = Math.max(peak, Math.abs(x), mid)
    l.prev3[c] = l.prev2[c]!
    l.prev2[c] = l.prev1[c]!
    l.prev1[c] = x
  }
  const target = peak > l.ceiling ? l.ceiling / peak : 1

  // Kayan pencere en küçüğü (monoton kuyruk): pencereden çıkanları at, büyükleri arkadan sil.
  const cap = l.queueAt.length
  while (l.head !== l.tail && l.queueAt[l.head]! <= l.n - l.lookahead - 1)
    l.head = (l.head + 1) % cap
  while (l.head !== l.tail) {
    const last = (l.tail - 1 + cap) % cap
    if (l.queueGain[last]! < target) break
    l.tail = last
  }
  l.queueAt[l.tail] = l.n
  l.queueGain[l.tail] = target
  l.tail = (l.tail + 1) % cap
  const windowMin = l.queueGain[l.head]!
  l.n++

  l.gain += (windowMin - l.gain) * (windowMin < l.gain ? l.attack : l.release)

  const size = l.delay[0]!.length
  const read = (l.pos + 1) % size
  for (let c = 0; c < channels; c++) {
    const line = l.delay[c]!
    line[l.pos] = frame[c] ?? 0
    const y = line[read]! * l.gain
    // Son güvenlik: kalan küçük aşım tavanda kesilir.
    frame[c] = y > l.ceiling ? l.ceiling : y < -l.ceiling ? -l.ceiling : y
  }
  l.pos = read
}

// ---- Zincir -----------------------------------------------------------------------------------------

export interface LabParams {
  /** 0..1 */
  clarity: number
  /** 0..1 */
  air: number
  limiter: boolean
}

export interface LabChain {
  clarity: Exciter[]
  air: Exciter[]
  limiter: Limiter
  frame: Float32Array
}

export function labChain(sampleRate: number, channels: number): LabChain {
  return {
    clarity: Array.from({ length: channels }, () => exciter(sampleRate, 2500, 2.2, 0.5)),
    air: Array.from({ length: channels }, () => exciter(sampleRate, 9000, 2.8, 0.7)),
    limiter: limiter(sampleRate, channels),
    frame: new Float32Array(channels)
  }
}

/** Bir blok (kanal başına dizi, yerinde). */
export function processBlock(chain: LabChain, channels: Float32Array[], p: LabParams): void {
  const count = channels.length
  const length = channels[0]?.length ?? 0
  const frame = chain.frame
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < count; c++) {
      const ch = channels[c]!
      const x = ch[i]!
      let y = x
      if (p.clarity > 0) y += exciterStep(chain.clarity[c]!, x, p.clarity)
      if (p.air > 0) y += exciterStep(chain.air[c]!, x, p.air)
      frame[c] = y
    }
    if (p.limiter) limiterStep(chain.limiter, frame)
    for (let c = 0; c < count; c++) channels[c]![i] = frame[c]!
  }
}
