import { describe, expect, it } from 'vitest'
import type { NowPlaying } from '@core/musickit/player'
import { dropTarget, queueEntries } from './queueRows'

const np = (id: string): NowPlaying => ({
  id,
  title: id,
  artist: '',
  album: '',
  artworkTemplate: null,
  durationSec: 0,
  playbackType: 'encryptedFull'
})

describe('Sıradaki satırları (§3.2)', () => {
  it('anahtar: id + tekrar sırası; aralık sınırlanır', () => {
    const items = ['a', 'b', 'a', 'c'].map(np)
    expect(queueEntries(items, 0, 9).map((e) => [e.key, e.index])).toEqual([
      ['a#0', 0],
      ['b#0', 1],
      ['a#1', 2],
      ['c#0', 3]
    ])
    expect(queueEntries(items, 2, 3).map((e) => e.key)).toEqual(['a#0'])
  })

  it('sürükleme hedefi: yeni görünen yer → kuyruk sırası; yer değişmediyse null', () => {
    const entries = queueEntries(['n', 'a', 'b', 'c'].map(np), 1, 4)
    const [a, b, c] = entries
    expect(dropTarget([c!, a!, b!], 'c#0')).toEqual({ from: 3, to: 1 })
    expect(dropTarget([b!, c!, a!], 'a#0')).toEqual({ from: 1, to: 3 })
    expect(dropTarget(entries, 'b#0')).toBeNull()
    expect(dropTarget(entries, 'yok')).toBeNull()
  })
})
