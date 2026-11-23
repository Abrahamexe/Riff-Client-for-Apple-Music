import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/ipc-contract'
import type { NowPlaying } from '@core/musickit/player'
import { cardTrack, isQueued, nowPlayingTrack, trackIds } from './itemMenus'

const track = (id: string, playParams: Track['playParams']): Track => ({
  id,
  name: 'Şarkı',
  artistName: 'Sanatçı',
  albumName: 'Albüm',
  durationMs: null,
  playParams,
  artworkUrl: null
})

describe('şarkı menüsü kimlikleri', () => {
  it('katalog şarkısı: çalma = katalog id; arşiv id yok', () => {
    expect(trackIds(track('123', { id: '123', kind: 'song' }))).toEqual({
      play: '123',
      catalog: '123',
      library: null
    })
  })
  it('kataloğu olan arşiv şarkısı: katalog id ile çalar, ikisini de bilir', () => {
    expect(trackIds(track('i.abc', { id: 'i.abc', kind: 'song', catalogId: '456' }))).toEqual({
      play: '456',
      catalog: '456',
      library: 'i.abc'
    })
  })
  it('yalnızca arşivdeki (yüklenmiş) şarkı: katalog yok → bağlantı / sayfalar pasif', () => {
    expect(trackIds(track('i.x', { id: 'i.x', kind: 'song' }))).toEqual({
      play: 'i.x',
      catalog: null,
      library: 'i.x'
    })
  })
  it('şarkı kartı → şarkı', () => {
    const t = cardTrack({
      kind: 'song',
      id: '9',
      name: 'A',
      subtitle: 'B',
      artworkUrl: null,
      playParams: { id: '9', kind: 'song' },
      explicit: true
    })
    expect(t).toMatchObject({ id: '9', name: 'A', artistName: 'B', explicit: true })
  })
})

describe('kuyruk öğesi → şarkı (Sıradaki menüsü, §3.2)', () => {
  const np = (over: Partial<NowPlaying>): NowPlaying => ({
    id: '1',
    title: 'Hurt',
    artist: 'Johnny Cash',
    album: 'American IV',
    artworkTemplate: null,
    durationSec: 218.4,
    playbackType: 'encryptedFull',
    ...over
  })
  it('katalog öğesi: kimlikler katalog id', () => {
    const t = nowPlayingTrack(np({ id: '42', catalogId: '42' }))
    expect(t).toMatchObject({ name: 'Hurt', artistName: 'Johnny Cash', durationMs: 218_400 })
    expect(trackIds(t)).toEqual({ play: '42', catalog: '42', library: null })
  })
  it('arşiv öğesi: katalog id ile çalar; katalog yoksa sayfalar pasif', () => {
    expect(trackIds(nowPlayingTrack(np({ id: 'i.a', catalogId: '7' })))).toEqual({
      play: '7',
      catalog: '7',
      library: 'i.a'
    })
    expect(trackIds(nowPlayingTrack(np({ id: 'i.b', durationSec: 0 })))).toEqual({
      play: 'i.b',
      catalog: null,
      library: 'i.b'
    })
  })
})

describe('yazma sonucu kuyrukta mı (§3.4)', () => {
  it('yalnızca `queued: true`', () => {
    expect(isQueued({ queued: true })).toBe(true)
    expect(isQueued({ queued: false })).toBe(false)
    expect(isQueued(undefined)).toBe(false)
    expect(isQueued(null)).toBe(false)
    expect(isQueued({ playlist: {}, queued: true })).toBe(true)
  })
})
