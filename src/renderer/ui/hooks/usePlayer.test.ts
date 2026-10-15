import { describe, expect, it } from 'vitest'
import type { NowPlaying, PlayerSnapshot } from '@core/musickit/player'
import { displayedTrack, formatTime } from './usePlayer'

const track = (id: string): NowPlaying => ({
  id,
  title: id,
  artist: '',
  album: '',
  artworkTemplate: null,
  durationSec: 1,
  playbackType: 'encryptedFull'
})
const snap = (over: Partial<PlayerSnapshot>): PlayerSnapshot => ({
  state: 'paused',
  nowPlaying: null,
  currentTime: 0,
  duration: 0,
  volume: 1,
  shuffle: false,
  repeat: 'none',
  queue: { items: [track('a'), track('b')], position: -1, autoplayIndex: null },
  ...over
})

describe('oynatıcı görünümü (B3)', () => {
  it('çalan şarkı; kuyruk başlamadıysa ilk şarkı; boş kuyrukta null', () => {
    expect(displayedTrack(snap({ nowPlaying: track('x') }))?.id).toBe('x')
    expect(displayedTrack(snap({}))?.id).toBe('a')
    expect(
      displayedTrack(
        snap({ queue: { items: [track('a'), track('b')], position: 1, autoplayIndex: null } })
      )?.id
    ).toBe('b')
    expect(
      displayedTrack(snap({ queue: { items: [], position: -1, autoplayIndex: null } }))
    ).toBeNull()
    expect(displayedTrack(null)).toBeNull()
  })

  it('süre biçimi', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(125.9)).toBe('2:05')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})
