import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/ipc-contract'
import type { NowPlaying, PlayerSnapshot } from '@core/musickit/player'
import {
  PENDING_TIMEOUT_MS,
  pendingAsNowPlaying,
  pendingPlay,
  sameSong,
  settled,
  toPending
} from './pendingPlay'

const track = (over: Partial<Track> = {}): Track => ({
  id: 'i.lib1',
  name: 'Şarkı',
  artistName: 'Sanatçı',
  albumName: 'Albüm',
  durationMs: 200_000,
  playParams: { id: 'i.lib1', kind: 'song', catalogId: '111' },
  artworkUrl: 'https://example.test/{w}x{h}.jpg',
  ...over
})

const now = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  id: 'old',
  title: 'Eski',
  artist: 'A',
  album: 'B',
  artworkTemplate: null,
  durationSec: 100,
  playbackType: 'encryptedFull',
  ...over
})

const snap = (state: PlayerSnapshot['state'], nowPlaying: NowPlaying | null): PlayerSnapshot =>
  ({ state, nowPlaying }) as PlayerSnapshot

describe('pendingPlay', () => {
  afterEach(() => {
    pendingPlay.clear()
    vi.useRealTimers()
  })

  it('şarkıdan bekleyen kayıt kurar; kapak yoksa albüm kapağına düşer', () => {
    const p = toPending(track({ artworkUrl: null }), now(), 'https://example.test/album.jpg')
    expect(p).toMatchObject({
      id: 'i.lib1',
      catalogId: '111',
      title: 'Şarkı',
      durationSec: 200,
      artworkUrl: 'https://example.test/album.jpg',
      previousId: 'old'
    })
  })

  it('kütüphane ve katalog id’leriyle eşleşir', () => {
    const p = toPending(track(), null)
    expect(sameSong(p, now({ id: 'i.lib1' }))).toBe(true)
    expect(sameSong(p, now({ id: 'x', catalogId: '111' }))).toBe(true)
    expect(sameSong(p, now({ id: '111' }))).toBe(true)
    expect(sameSong(p, now({ id: 'x', catalogId: '222' }))).toBe(false)
    expect(sameSong(p, null)).toBe(false)
  })

  it('basılan şarkı çalmaya başlayınca biter; yüklenirken bitmez', () => {
    const p = toPending(track(), now())
    expect(settled(p, snap('loading', now({ id: 'i.lib1' })))).toBe(false)
    expect(settled(p, snap('playing', now({ id: 'i.lib1' })))).toBe(true)
  })

  it('eski şarkı hâlâ çalıyorken bitmez, başka bir şarkı başlayınca biter', () => {
    const p = toPending(track(), now())
    expect(settled(p, snap('playing', now()))).toBe(false)
    expect(settled(p, snap('playing', now({ id: 'shuffled' })))).toBe(true)
    expect(settled(p, null)).toBe(false)
  })

  it('çubukta bekleyen şarkı gösterilir', () => {
    expect(pendingAsNowPlaying(toPending(track(), null))).toMatchObject({
      id: 'i.lib1',
      title: 'Şarkı',
      artist: 'Sanatçı',
      artworkTemplate: 'https://example.test/{w}x{h}.jpg',
      durationSec: 200,
      catalogId: '111'
    })
  })

  it('depo dinleyicilere bildirir ve zaman aşımında kendini temizler', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const off = pendingPlay.subscribe(listener)
    pendingPlay.set(toPending(track(), null))
    expect(pendingPlay.get()?.id).toBe('i.lib1')
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS)
    expect(pendingPlay.get()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })
})
