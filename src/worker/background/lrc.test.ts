import { describe, expect, it } from 'vitest'
import { MAX_LYRIC_LINES } from '@shared/lyrics'
import { cleanLine, parseLrc, parsePlain } from './lrc'

describe('parseLrc (B11b)', () => {
  it('zaman etiketli satırları ms olarak çözer; 1–3 haneli kesir ve ":" ayırıcı', () => {
    const lrc =
      '[00:17.12] I feel your breath\n[00:20.5]ikinci\n[01:02.345] üçüncü\n[02:03:40] dördüncü\n[03:04] beşinci'
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 17_120, text: 'I feel your breath' },
      { timeMs: 20_500, text: 'ikinci' },
      { timeMs: 62_345, text: 'üçüncü' },
      { timeMs: 123_400, text: 'dördüncü' },
      { timeMs: 184_000, text: 'beşinci' }
    ])
  })

  it('bir satırdaki birden çok etiket satırı tekrarlar; sonuç zamana göre sıralı', () => {
    expect(parseLrc('[00:30.00][00:10.00]nakarat\n[00:20.00]köprü')).toEqual([
      { timeMs: 10_000, text: 'nakarat' },
      { timeMs: 20_000, text: 'köprü' },
      { timeMs: 30_000, text: 'nakarat' }
    ])
  })

  it('üst veri etiketleri yok sayılır; offset uygulanır (pozitif = daha erken, 0 altına inmez)', () => {
    const lrc = '[ar:Queen]\n[ti:Bohemian Rhapsody]\n[offset:+500]\n[00:00.20]a\n[00:10.00]b'
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 0, text: 'a' },
      { timeMs: 9_500, text: 'b' }
    ])
    expect(parseLrc('[offset:-250]\n[00:01.00]a')).toEqual([{ timeMs: 1_250, text: 'a' }])
  })

  it('boş satırlar: baştaki/sondaki atılır, art arda olanlar teke iner (müzikal ara)', () => {
    const lrc = '[00:00.00]\n[00:05.00]a\n[00:10.00]\n[00:11.00]  \n[00:15.00]b\n[03:25.72] '
    expect(parseLrc(lrc)).toEqual([
      { timeMs: 5_000, text: 'a' },
      { timeMs: 10_000, text: '' },
      { timeMs: 15_000, text: 'b' }
    ])
  })

  it('kelime zamanları ve kontrol karakterleri atılır; CRLF ve geçersiz saniye', () => {
    expect(parseLrc('[00:01.00]<00:01.00>Merhaba <00:01.50>dünya\u0007\r\n[00:99.00]x')).toEqual([
      { timeMs: 1_000, text: 'Merhaba dünya' }
    ])
  })

  it('zaman etiketi yoksa boş; HTML yorumlanmaz, metin olarak kalır', () => {
    expect(parseLrc('düz metin\nikinci satır')).toEqual([])
    expect(parseLrc('[00:01.00]<b>kalın</b>')).toEqual([{ timeMs: 1_000, text: '<b>kalın</b>' }])
  })

  it('satır sayısı ve uzunluğu sınırlıdır', () => {
    const many = Array.from({ length: MAX_LYRIC_LINES + 50 }, (_, i) => `[00:${i % 60}.00]x${i}`)
    expect(parseLrc(many.join('\n'))).toHaveLength(MAX_LYRIC_LINES)
    expect(cleanLine('a'.repeat(5_000))).toHaveLength(1_000)
  })
})

describe('parsePlain (B11b)', () => {
  it('satırları zamansız döner; boş satır düzeni sadeleşir', () => {
    expect(parsePlain('\n\nbir\n\n\n\niki\r\nüç\n\n')).toEqual([
      { timeMs: null, text: 'bir' },
      { timeMs: null, text: '' },
      { timeMs: null, text: 'iki' },
      { timeMs: null, text: 'üç' }
    ])
  })
})
