import { MAX_LYRIC_LINES, type LyricLine } from '@shared/lyrics'

// LRC çözümleyici (B11b). LRCLIB'in `syncedLyrics` alanı satır zamanlı LRC metnidir:
//   [00:17.12] I feel your breath upon my neck
// Desteklenenler: bir satırda birden çok zaman etiketi (`[00:10.00][01:20.00] nakarat`), 1–3 haneli
// kesir (`.5` = 500 ms, `.50` = 500 ms, `.500` = 500 ms) veya `:` ayırıcı, `[offset:±ms]` etiketi
// (pozitif = sözler daha erken), satır içi kelime zamanları (`<00:12.34>`, atılır). Diğer üst veri
// etiketleri (`[ar:…]`, `[ti:…]`) yok sayılır. Satırlar zamana göre sıralanır; baştaki/sondaki boş
// satırlar atılır, art arda boşlar teke iner (boş satır = müzikal ara). Metin düz metindir.

const MAX_LINE_CHARS = 1_000
const STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
const OFFSET = /^\[offset:\s*([+-]?\d{1,7})\s*\]/i
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

/** Kontrol karakterlerini atar, boşlukları sadeleştirir, uzun satırı keser. */
export function cleanLine(value: string): string {
  const text = value
    // eslint-disable-next-line no-control-regex -- kontrol karakterleri bilerek temizleniyor
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text
}

function stampMs(min: string, sec: string, frac: string | undefined): number | null {
  const s = Number(sec)
  if (s >= 60) return null
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0
  return (Number(min) * 60 + s) * 1000 + ms
}

/** Baştaki/sondaki boş satırları atar, art arda boşları teke indirir, satır sınırını uygular. */
function tidy<T extends { text: string }>(lines: T[]): T[] {
  const out: T[] = []
  for (const line of lines) {
    if (line.text === '' && (out.length === 0 || out[out.length - 1]!.text === '')) continue
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1]!.text === '') out.pop()
  return out.slice(0, MAX_LYRIC_LINES)
}

/** LRC metnini zamanlı satırlara çevirir; hiç zaman etiketi yoksa boş dizi. */
export function parseLrc(lrc: string): LyricLine[] {
  let offsetMs = 0
  const timed: { timeMs: number; text: string; order: number }[] = []
  for (const raw of lrc.split(/\r\n|\r|\n/)) {
    let rest = raw.trim()
    const offset = OFFSET.exec(rest)
    if (offset) {
      offsetMs = Number(offset[1])
      continue
    }
    const stamps: number[] = []
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      const ms = stampMs(m[1]!, m[2]!, m[3])
      if (ms !== null) stamps.push(ms)
      rest = rest.slice(m[0].length).trimStart()
    }
    if (stamps.length === 0) continue
    const text = cleanLine(rest.replace(WORD_STAMP, ''))
    for (const timeMs of stamps) timed.push({ timeMs, text, order: timed.length })
    if (timed.length > MAX_LYRIC_LINES * 2) break
  }
  timed.sort((a, b) => a.timeMs - b.timeMs || a.order - b.order)
  return tidy(timed.map(({ timeMs, text }) => ({ timeMs: Math.max(0, timeMs - offsetMs), text })))
}

/** Düz söz metnini zamansız satırlara çevirir. */
export function parsePlain(text: string): LyricLine[] {
  return tidy(
    text
      .split(/\r\n|\r|\n/)
      .slice(0, MAX_LYRIC_LINES * 2)
      .map((line) => ({ timeMs: null, text: cleanLine(line) }))
  )
}
