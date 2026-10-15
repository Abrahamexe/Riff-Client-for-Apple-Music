import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindMediaSession } from './mediaSession'
import { Player } from './player'
import { PlaybackState, type MediaItem, type MusicKitInstance } from './types'

class FakeMediaMetadata {
  constructor(public init: Record<string, unknown>) {}
}

function setup() {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  const raw = {
    playbackState: 0 as number,
    nowPlayingItem: undefined as MediaItem | undefined,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    volume: 1,
    shuffleMode: 0,
    repeatMode: 0,
    queue: { items: [], position: 0 },
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(async () => {}),
    skipToNextItem: vi.fn(async () => {}),
    skipToPreviousItem: vi.fn(async () => {}),
    seekToTime: vi.fn(async () => {}),
    addEventListener: (n: string, f: (e: unknown) => void) => {
      if (!listeners.has(n)) listeners.set(n, new Set())
      listeners.get(n)!.add(f)
    },
    removeEventListener: vi.fn()
  }
  const fire = (n: string): void => listeners.get(n)?.forEach((f) => f(undefined))
  const handlers = new Map<string, ((d: Record<string, unknown>) => void) | null>()
  const session = {
    metadata: undefined as unknown,
    playbackState: 'none',
    setPositionState: vi.fn(),
    setActionHandler: vi.fn((a: string, h: ((d: Record<string, unknown>) => void) | null) => {
      handlers.set(a, h)
    })
  }
  vi.stubGlobal('MediaMetadata', FakeMediaMetadata)
  const player = new Player(raw as unknown as MusicKitInstance)
  const unbind = bindMediaSession(player, session as unknown as MediaSession)
  return { raw, fire, session, handlers, unbind, player }
}

afterEach(() => vi.unstubAllGlobals())

describe('bindMediaSession', () => {
  it('başlık, sanatçı, albüm ve kapak bilgisini SMTC’ye aktarır', () => {
    const { raw, fire, session } = setup()
    raw.nowPlayingItem = {
      id: '1',
      title: 'Başlık',
      artistName: 'Sanatçı',
      albumName: 'Albüm',
      artwork: { url: 'https://x/{w}x{h}.jpg' }
    }
    fire('nowPlayingItemDidChange')
    const meta = session.metadata as FakeMediaMetadata
    expect(meta.init).toEqual({
      title: 'Başlık',
      artist: 'Sanatçı',
      album: 'Albüm',
      artwork: [{ src: 'https://x/512x512.jpg', sizes: '512x512', type: 'image/jpeg' }]
    })
    raw.nowPlayingItem = undefined
    fire('nowPlayingItemDidChange')
    expect(session.metadata).toBeNull()
  })

  it('çalma durumunu Media Session durumuna eşler', () => {
    const { raw, fire, session } = setup()
    raw.playbackState = PlaybackState.playing
    fire('playbackStateDidChange')
    expect(session.playbackState).toBe('playing')
    raw.playbackState = PlaybackState.paused
    fire('playbackStateDidChange')
    expect(session.playbackState).toBe('paused')
    raw.playbackState = PlaybackState.stopped
    fire('playbackStateDidChange')
    expect(session.playbackState).toBe('none')
  })

  it('konum bilgisini süre ve konumla günceller; geçersiz süreyi atlar', () => {
    const { raw, fire, session } = setup()
    raw.currentPlaybackTime = 30
    raw.currentPlaybackDuration = 200
    fire('playbackTimeDidChange')
    expect(session.setPositionState).toHaveBeenCalledWith({
      duration: 200,
      position: 30,
      playbackRate: 1
    })
    session.setPositionState.mockClear()
    raw.currentPlaybackDuration = 0
    vi.setSystemTime(Date.now() + 5000)
    fire('playbackTimeDidChange')
    expect(session.setPositionState).not.toHaveBeenCalled()
  })

  it('medya tuşu eylemlerini Player’a bağlar', async () => {
    const { raw, handlers } = setup()
    handlers.get('play')!({})
    handlers.get('pause')!({})
    handlers.get('nexttrack')!({})
    handlers.get('previoustrack')!({})
    handlers.get('stop')!({})
    handlers.get('seekto')!({ seekTime: 77 })
    // play() önce CDM kapısını bekler (1.2R); MusicKit çağrısı bir mikro-görev sonra gelir.
    await vi.waitFor(() => expect(raw.play).toHaveBeenCalled())
    expect(raw.pause).toHaveBeenCalled()
    expect(raw.skipToNextItem).toHaveBeenCalled()
    expect(raw.skipToPreviousItem).toHaveBeenCalled()
    expect(raw.stop).toHaveBeenCalled()
    expect(raw.seekToTime).toHaveBeenCalledWith(77)
  })

  it('geri/ileri sarma 10 sn adımıyla çalışır', () => {
    const { raw, handlers } = setup()
    raw.currentPlaybackTime = 50
    handlers.get('seekforward')!({})
    handlers.get('seekbackward')!({ seekOffset: 5 })
    expect(raw.seekToTime).toHaveBeenNthCalledWith(1, 60)
    expect(raw.seekToTime).toHaveBeenNthCalledWith(2, 45)
  })

  it('unbind eylem işleyicilerini kaldırır', () => {
    const { unbind, handlers } = setup()
    unbind()
    expect(handlers.get('play')).toBeNull()
    expect(handlers.get('nexttrack')).toBeNull()
  })

  it('Media Session yoksa hata vermeden no-op olur', () => {
    const player = new Player({
      addEventListener: () => {},
      removeEventListener: () => {},
      playbackState: 0,
      queue: { items: [], position: 0 }
    } as unknown as MusicKitInstance)
    expect(() => bindMediaSession(player, undefined)()).not.toThrow()
  })
})
