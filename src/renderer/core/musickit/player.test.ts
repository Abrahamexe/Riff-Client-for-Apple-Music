import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreError } from '../errors'
import { setGuardHandlers } from './guard'
import { Player, PREVIOUS_RESTART_S, preciseTime, resolveArtwork, toNowPlaying } from './player'
import {
  PlaybackState,
  PlaybackType,
  ShuffleMode,
  type MediaItem,
  type MusicKitInstance
} from './types'

function fakeMusic() {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  const state = {
    playbackState: PlaybackState.none as number,
    nowPlayingItem: undefined as MediaItem | undefined,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    nowPlayingItemIndex: 0,
    volume: 1,
    shuffleMode: 0,
    repeatMode: 0,
    queue: { items: [] as MediaItem[], position: 0 } as MusicKitInstance['queue']
  }
  const music = Object.assign(state, {
    setQueue: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
    playNext: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
    playLater: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(async () => {}),
    skipToNextItem: vi.fn(async () => {}),
    skipToPreviousItem: vi.fn(async () => {}),
    seekToTime: vi.fn(async () => {}),
    changeToMediaAtIndex: vi.fn(async () => {}),
    addEventListener: vi.fn((name: string, fn: (e: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(fn)
    }),
    removeEventListener: vi.fn((name: string, fn: (e: unknown) => void) => {
      listeners.get(name)?.delete(fn)
    })
  })
  const fire = (name: string, payload?: unknown): void =>
    listeners.get(name)?.forEach((fn) => fn(payload))
  const count = (name: string): number => listeners.get(name)?.size ?? 0
  return { music: music as unknown as MusicKitInstance, raw: music, fire, count }
}

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: '1',
  title: 'Şarkı',
  artistName: 'Sanatçı',
  albumName: 'Albüm',
  artwork: { url: 'https://x/{w}x{h}bb.jpg' },
  playbackType: PlaybackType.encryptedFull,
  playbackDuration: 200_000,
  ...over
})

beforeEach(() => setGuardHandlers({ retry: { sleep: async () => {}, random: () => 0 } }))
afterEach(() => setGuardHandlers({}))

describe('toNowPlaying / resolveArtwork', () => {
  it('MediaItem’ı çevirir; attributes fallback ve playbackType adı', () => {
    expect(toNowPlaying(item())).toEqual({
      id: '1',
      title: 'Şarkı',
      artist: 'Sanatçı',
      album: 'Albüm',
      artworkTemplate: 'https://x/{w}x{h}bb.jpg',
      durationSec: 200,
      playbackType: 'encryptedFull',
      catalogId: '1'
    })
    const viaAttrs = toNowPlaying({
      id: '2',
      attributes: { name: 'A', artistName: 'B', albumName: 'C' },
      playbackType: PlaybackType.preview
    })
    expect(viaAttrs).toMatchObject({ title: 'A', artist: 'B', album: 'C', playbackType: 'preview' })
    expect(toNowPlaying(undefined)).toBeNull()
  })

  it('katalog id (V8): kütüphane öğesinde playParams.catalogId, katalog öğesinde sayısal id', () => {
    const lib = item({
      id: 'i.ABC',
      attributes: { playParams: { id: 'i.ABC', catalogId: '1440857781' } }
    })
    expect(toNowPlaying(lib)?.catalogId).toBe('1440857781')
    expect(toNowPlaying(item({ id: '697195787' }))?.catalogId).toBe('697195787')
    expect(toNowPlaying(item({ id: 'i.ABC' }))?.catalogId).toBeUndefined()
    const bad = item({ id: 'i.X', playParams: { catalogId: '12a' } })
    expect(toNowPlaying(bad)?.catalogId).toBeUndefined()
  })

  it('artwork şablonunu boyutlandırır', () => {
    expect(resolveArtwork('https://x/{w}x{h}.jpg', 512)).toBe('https://x/512x512.jpg')
    expect(resolveArtwork(null)).toBeNull()
  })
})

describe('event’ler', () => {
  it('MusicKit event’lerini tipli event’lere çevirir', () => {
    const { music, raw, fire } = fakeMusic()
    const p = new Player(music)
    const states: unknown[] = []
    const nowPlaying: unknown[] = []
    const times: unknown[] = []
    const queues: unknown[] = []
    p.on('playbackStateDidChange', (e) => states.push(e))
    p.on('nowPlayingItemDidChange', (e) => nowPlaying.push(e))
    p.on('playbackTimeDidChange', (e) => times.push(e))
    p.on('queueItemsDidChange', (e) => queues.push(e))

    raw.playbackState = PlaybackState.playing
    fire('playbackStateDidChange')
    raw.playbackState = PlaybackState.paused
    fire('playbackStateDidChange')
    raw.nowPlayingItem = item()
    fire('nowPlayingItemDidChange')
    raw.currentPlaybackTime = 12.5
    raw.currentPlaybackDuration = 200
    fire('playbackTimeDidChange')
    raw.queue = { items: [item(), item({ id: '2' })], position: 1 }
    fire('queueItemsDidChange')

    expect(states).toEqual([
      { state: 'playing', previous: 'none' },
      { state: 'paused', previous: 'playing' }
    ])
    expect(nowPlaying[0]).toMatchObject({ title: 'Şarkı', playbackType: 'encryptedFull' })
    expect(times).toEqual([{ currentTime: 12.5, duration: 200 }])
    expect(queues[0]).toMatchObject({ position: 1, autoplayIndex: null })
    expect((queues[0] as { items: unknown[] }).items).toHaveLength(2)

    // P3: MusicKit `autoplayItems` → otomatik çalma bölümünün başladığı sıra (kullanıcı öğeleri önde).
    const user = item({ id: 'u1' })
    const autoA = item({ id: 'a1' })
    const autoB = item({ id: 'a2' })
    raw.queue = { items: [user, autoA, autoB], position: 0, autoplayItems: [autoA, autoB] }
    fire('queueItemsDidChange')
    expect(queues.at(-1)).toMatchObject({ autoplayIndex: 1 })
  })

  it('bir dinleyicinin hatası diğerlerini engellemez', () => {
    const { music, fire } = fakeMusic()
    const p = new Player(music)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()
    p.on('playbackStateDidChange', () => {
      throw new Error('kötü dinleyici')
    })
    p.on('playbackStateDidChange', ok)
    fire('playbackStateDidChange')
    expect(ok).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unsubscribe ve dispose dinleyicileri temizler', () => {
    const { music, fire, count } = fakeMusic()
    const p = new Player(music)
    const fn = vi.fn()
    const off = p.on('playbackStateDidChange', fn)
    off()
    fire('playbackStateDidChange')
    expect(fn).not.toHaveBeenCalled()
    expect(count('playbackStateDidChange')).toBe(1)
    p.dispose()
    expect(count('playbackStateDidChange')).toBe(0)
  })

  it('mediaPlaybackError DRM kodunu loglar ve error event’i yayar', () => {
    const { music, fire } = fakeMusic()
    const p = new Player(music)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errors: CoreError[] = []
    p.on('error', (e) => errors.push(e))
    fire('mediaPlaybackError', {
      errorCode: 'MEDIA_LICENSE',
      message: 'lisans reddedildi',
      name: 'MKError'
    })
    expect(errors[0]!.code).toBe('PLAYBACK_FAILED')
    expect(errors[0]!.message).toContain('MEDIA_LICENSE')
    expect(spy.mock.calls[0]![0]).toContain('MEDIA_LICENSE')
    spy.mockRestore()
  })

  it.each(['STREAM_UPSELL', 'DEVICE_LIMIT'])(
    'eşzamanlı akış sınırı (%s) ayrı kodla bildirilir (2.3 gözlemi)',
    (errorCode) => {
      const { music, fire } = fakeMusic()
      const p = new Player(music)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const errors: CoreError[] = []
      p.on('error', (e) => errors.push(e))
      fire('mediaPlaybackError', {
        errorCode,
        message: 'Birden fazla aygıt müzik çalmaya çalışıyor.'
      })
      expect(errors[0]!.code).toBe('PLAYBACK_STREAM_LIMIT')
      expect(errors[0]!.id).toBe('PLAY_004')
    }
  )
})

describe('kuyruk ve çalma', () => {
  it('playSong: setQueue({song}) sonra play()', async () => {
    const { music, raw } = fakeMusic()
    await new Player(music).playSong(' 123 ')
    expect(raw.setQueue).toHaveBeenCalledWith({ song: '123' })
    expect(raw.play).toHaveBeenCalled()
    expect(raw.setQueue.mock.invocationCallOrder[0]).toBeLessThan(
      raw.play.mock.invocationCallOrder[0]!
    )
  })

  it('playPlaylist / playAlbum belirli şarkıdan başlatır', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.playPlaylist('p.1', 3)
    await p.playAlbum('l.9')
    expect(raw.setQueue).toHaveBeenNthCalledWith(1, { playlist: 'p.1', startWith: 3 })
    expect(raw.setQueue).toHaveBeenNthCalledWith(2, { album: 'l.9' })
  })

  it('playSongs: şarkı listesi belirli sıradan; boş liste reddedilir', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.playSongs(['1', '2', '3'], 2)
    expect(raw.setQueue).toHaveBeenCalledWith({ songs: ['1', '2', '3'], startWith: 2 })
    expect(() => p.playSongs([])).toThrow(CoreError)
    expect(() => p.playSongs(['1'], -1)).toThrow(CoreError)
  })

  it('playStation: setQueue({station}) sonra play(); boş id reddedilir', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.playStation('ra.123')
    expect(raw.setQueue).toHaveBeenCalledWith({ station: 'ra.123' })
    expect(raw.play).toHaveBeenCalled()
    expect(() => p.playStation(' ')).toThrow(CoreError)
  })

  it('enqueue: Sıradaki Çal → playNext, Sonra Çal → playLater; boş id reddedilir', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.enqueue({ kind: 'song', id: '42' }, 'next')
    await p.enqueue({ kind: 'album', id: '7' }, 'later')
    expect(raw.playNext).toHaveBeenCalledWith({ song: '42' })
    expect(raw.playLater).toHaveBeenCalledWith({ album: '7' })
    expect(() => p.enqueue({ kind: 'song', id: ' ' }, 'next')).toThrow(CoreError)
    raw.playLater.mockRejectedValueOnce(new Error('x'))
    await expect(p.enqueue({ kind: 'playlist', id: 'p.1' }, 'later')).rejects.toMatchObject({
      code: 'PLAYBACK_FAILED'
    })
  })

  it('geçersiz argümanlar INVALID_ARGUMENT fırlatır ve MusicKit’e dokunmaz', () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    expect(() => p.playSong('')).toThrow(CoreError)
    expect(() => p.playPlaylist('p.1', -1)).toThrow(CoreError)
    expect(() => p.playPlaylist('p.1', 1.5)).toThrow(CoreError)
    expect(() => p.setVolume(NaN)).toThrow(CoreError)
    expect(raw.setQueue).not.toHaveBeenCalled()
  })

  it('play hatası PLAYBACK_FAILED olarak fırlatılır ve error event’i yayınlanır', async () => {
    const { music, raw } = fakeMusic()
    raw.play.mockRejectedValueOnce({ errorCode: 'SUBSCRIPTION_ERROR', message: 'abonelik yok' })
    const p = new Player(music)
    const errors: CoreError[] = []
    p.on('error', (e) => errors.push(e))
    await expect(p.playSong('1')).rejects.toMatchObject({ code: 'PLAYBACK_FAILED' })
    expect(errors).toHaveLength(1)
  })

  it('setQueue 401 alırsa UNAUTHORIZED ve onUnauthorized tetiklenir', async () => {
    const onUnauthorized = vi.fn()
    setGuardHandlers({ onUnauthorized, retry: { sleep: async () => {} } })
    const { music, raw } = fakeMusic()
    raw.setQueue.mockRejectedValue({ data: { status: 401 } })
    await expect(new Player(music).playSong('1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(onUnauthorized).toHaveBeenCalled()
    expect(raw.play).not.toHaveBeenCalled()
  })
})

describe('restoreQueue (1.7a player_state)', () => {
  it('kuyruğu çalmadan kurar; sırayı kuyruk sınırına kırpar; boş kuyrukta dokunmaz', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.restoreQueue({ queue: ['1', ' ', '2'], position: 9 })
    expect(raw.setQueue).toHaveBeenCalledWith({
      songs: ['1', '2'],
      startWith: 1,
      startPlaying: false
    })
    expect(raw.play).not.toHaveBeenCalled()
    await p.restoreQueue({ queue: [], position: 0 })
    expect(raw.setQueue).toHaveBeenCalledTimes(1)
  })

  it('kaydedilen konum, geri yüklenen şarkı ilk çalınınca uygulanır (bir kez)', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.restoreQueue({ queue: ['i.1', 'i.2', 'i.3'], position: 1, currentTime: 95 })
    raw.nowPlayingItemIndex = 1
    await p.play()
    expect(raw.seekToTime).toHaveBeenCalledWith(95)
    await p.pause()
    await p.play()
    expect(raw.seekToTime).toHaveBeenCalledTimes(1)
  })

  it('V9: geri yüklenen konum, çalmadan önce de bildirilir (kurulum sırasındaki kayıt 0 yazmaz)', async () => {
    const { music, raw, fire } = fakeMusic()
    const p = new Player(music)
    const seen: number[] = []
    p.on('queueItemsDidChange', () => seen.push(p.snapshot().currentTime))
    raw.setQueue.mockImplementationOnce(async () => fire('queueItemsDidChange'))
    await p.restoreQueue({ queue: ['i.1', 'i.2'], position: 1, currentTime: 42 })
    expect(seen).toEqual([42])
    expect(p.snapshot().currentTime).toBe(42)
    raw.currentPlaybackTime = 3 // çalmaya başladı: gerçek konum esas
    expect(p.snapshot().currentTime).toBe(3)
  })

  it('kullanıcı başka şarkıya geçerse veya konum değiştirirse kayıtlı konum uygulanmaz', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.restoreQueue({ queue: ['i.1', 'i.2'], position: 0, currentTime: 50 })
    await p.next()
    raw.nowPlayingItemIndex = 1
    await p.play()
    expect(raw.seekToTime).not.toHaveBeenCalled()

    await p.restoreQueue({ queue: ['i.1', 'i.2'], position: 1, currentTime: 50 })
    await p.seek(10)
    await p.play()
    expect(raw.seekToTime).toHaveBeenCalledTimes(1)
    expect(raw.seekToTime).toHaveBeenLastCalledWith(10)
  })

  it('V6 yarışı: geri yükleme sürerken seçilen playlist, geri yüklemeden SONRA kurulur ve çalar', async () => {
    const { music, raw } = fakeMusic()
    let finishRestore: () => void = () => {}
    raw.setQueue.mockImplementationOnce(() => new Promise<void>((r) => (finishRestore = r)))
    const p = new Player(music)
    const restoring = p.restoreQueue({ queue: ['1'], position: 0, currentTime: 30 })
    const playing = p.playPlaylist('p.1', 2)
    await vi.waitFor(() => expect(raw.setQueue).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(raw.setQueue).toHaveBeenCalledTimes(1) // playlist geri yükleme bitmeden kurulmaz
    finishRestore()
    await Promise.all([restoring, playing])
    expect(raw.setQueue).toHaveBeenLastCalledWith({ playlist: 'p.1', startWith: 2 })
    expect(raw.play).toHaveBeenCalledTimes(1)
    expect(raw.seekToTime).not.toHaveBeenCalled() // eski kuyruğun konumu yeni şarkıya uygulanmaz
  })

  it('holdQueueUntil (R2): kuyruk işlemleri bariyer bitene kadar bekler; bariyer hatası yutulur', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    let release: (ok: boolean) => void = () => {}
    p.holdQueueUntil(
      new Promise<void>((res, rej) => (release = (ok) => (ok ? res() : rej(new Error('ağ')))))
    )
    const restoring = p.restoreQueue({ queue: ['eski'], position: 0 })
    const playing = p.playSong('200')
    await new Promise((r) => setTimeout(r, 10))
    expect(raw.setQueue).not.toHaveBeenCalled()
    release(false)
    await Promise.all([restoring, playing])
    // Başlamamış geri yükleme kullanıcı isteğiyle atlandı; yalnızca kullanıcının kuyruğu kuruldu.
    expect(raw.setQueue.mock.calls.map((c) => c[0])).toEqual([{ song: '200' }])
  })

  it('henüz başlamamış geri yükleme, arkasından kullanıcı isteği gelirse atlanır', async () => {
    const { music, raw } = fakeMusic()
    let finishFirst: () => void = () => {}
    raw.setQueue.mockImplementationOnce(() => new Promise<void>((r) => (finishFirst = r)))
    const p = new Player(music)
    const first = p.playSong('100')
    const restoring = p.restoreQueue({ queue: ['eski'], position: 0 })
    const second = p.playSong('200')
    await vi.waitFor(() => expect(raw.setQueue).toHaveBeenCalledTimes(1))
    finishFirst()
    await Promise.all([first, restoring, second])
    expect(raw.setQueue.mock.calls.map((c) => c[0])).toEqual([{ song: '100' }, { song: '200' }])
  })
})

describe('CDM kapısı (1.2R)', () => {
  it('çalma, beforePlayback çözülene kadar bekletilir; kuyruk önceden hazırlanır', async () => {
    const { music, raw } = fakeMusic()
    let release!: () => void
    const beforePlayback = vi.fn(() => new Promise<void>((r) => (release = r)))
    const p = new Player(music, { beforePlayback })
    const playing = p.playSong('1')
    await vi.waitFor(() => expect(beforePlayback).toHaveBeenCalled())
    expect(raw.setQueue).toHaveBeenCalled()
    expect(raw.play).not.toHaveBeenCalled()
    release()
    await playing
    expect(raw.play).toHaveBeenCalledTimes(1)
  })

  it('CDM hatası çalmayı başlatmaz; hata error event’i ile aynen yayınlanır', async () => {
    const { music, raw } = fakeMusic()
    const drm = new CoreError('DRM_UNAVAILABLE', 'CDM yok')
    const p = new Player(music, { beforePlayback: () => Promise.reject(drm) })
    const errors: CoreError[] = []
    p.on('error', (e) => errors.push(e))
    await expect(p.play()).rejects.toBe(drm)
    await expect(p.playQueueIndex(2)).rejects.toBe(drm)
    expect(raw.play).not.toHaveBeenCalled()
    expect(raw.changeToMediaAtIndex).not.toHaveBeenCalled()
    expect(errors).toEqual([drm, drm])
  })

  it('duraklatma/durdurma CDM’i beklemez', async () => {
    const { music, raw } = fakeMusic()
    const beforePlayback = vi.fn(() => new Promise<void>(() => {}))
    const p = new Player(music, { beforePlayback })
    await p.pause()
    await p.stop()
    expect(raw.pause).toHaveBeenCalled()
    expect(beforePlayback).not.toHaveBeenCalled()
  })
})

describe('kontroller', () => {
  it('play/pause/stop/next/previous/seek MusicKit’e iletilir', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.play()
    await p.pause()
    await p.stop()
    await p.next()
    await p.previous()
    await p.seek(42)
    await p.playQueueIndex(2)
    expect(raw.play).toHaveBeenCalled()
    expect(raw.pause).toHaveBeenCalled()
    expect(raw.stop).toHaveBeenCalled()
    expect(raw.skipToNextItem).toHaveBeenCalled()
    expect(raw.skipToPreviousItem).toHaveBeenCalled()
    expect(raw.seekToTime).toHaveBeenCalledWith(42)
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(2)
  })

  it('önceki: PREVIOUS_RESTART_S sonrasında başa sarar, ilk saniyelerde önceki şarkıya geçer', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music, { mediaElements: () => [] })
    raw.nowPlayingItem = item()
    raw.currentPlaybackTime = 60
    await p.previous()
    expect(raw.seekToTime).toHaveBeenCalledWith(0)
    expect(raw.skipToPreviousItem).not.toHaveBeenCalled()
    raw.currentPlaybackTime = PREVIOUS_RESTART_S
    await p.previous()
    expect(raw.skipToPreviousItem).toHaveBeenCalledTimes(1)
  })

  it('seek negatifi 0’a, ses düzeyini 0..1’e kırpar', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    await p.seek(-5)
    expect(raw.seekToTime).toHaveBeenCalledWith(0)
    p.setVolume(3)
    expect(raw.volume).toBe(1)
    p.setVolume(-1)
    expect(raw.volume).toBe(0)
    p.setVolume(0.4)
    expect(raw.volume).toBe(0.4)
    await expect(p.seek(Infinity)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('seek: çalma öğesi hazırsa konumu doğrudan değiştirir, değilse seekToTime', async () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music, { mediaElements: () => [] })
    raw.nowPlayingItem = item()
    const el = { currentTime: 3, readyState: 4 }
    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'apple-music-player' ? el : null)
    })
    try {
      await p.seek(80)
      expect(el.currentTime).toBe(80)
      expect(raw.seekToTime).not.toHaveBeenCalled()
      el.readyState = 0 // henüz yüklenmedi
      await p.seek(90)
      expect(el.currentTime).toBe(80)
      expect(raw.seekToTime).toHaveBeenCalledWith(90)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shuffle ve repeat modlarını çevirir; snapshot yansıtır', () => {
    const { music, raw } = fakeMusic()
    const p = new Player(music)
    p.setShuffle(true)
    p.setRepeat('all')
    expect(raw.shuffleMode).toBe(1)
    expect(raw.repeatMode).toBe(2)
    expect(p.snapshot()).toMatchObject({ shuffle: true, repeat: 'all' })
    p.setShuffle(false)
    p.setRepeat('one')
    expect(p.snapshot()).toMatchObject({ shuffle: false, repeat: 'one' })
    expect(raw.repeatMode).toBe(1)
  })

  it('snapshot anlık durumu döner', () => {
    const { music, raw } = fakeMusic()
    raw.playbackState = PlaybackState.playing
    raw.nowPlayingItem = item()
    raw.currentPlaybackTime = 5
    raw.currentPlaybackDuration = 200
    raw.volume = 0.5
    expect(new Player(music).snapshot()).toMatchObject({
      state: 'playing',
      currentTime: 5,
      duration: 200,
      volume: 0.5,
      nowPlaying: { title: 'Şarkı' }
    })
  })
})

describe('Sıradaki düzenleme (§3.2)', () => {
  /** Kuyruk: 0 geçmiş, 1 çalan, 2–4 sıradaki, 5–6 otomatik çalma. */
  function setup(withSplice = true) {
    const { music, raw } = fakeMusic()
    const items = ['h', 'now', 'a', 'b', 'c', 'x', 'y'].map((id) => item({ id }))
    const queue = {
      items,
      position: 1,
      autoplayItems: [items[5]!, items[6]!],
      ...(withSplice
        ? {
            spliceQueueItems: vi.fn((start: number, count: number, add: unknown[] = []) =>
              items.splice(start, count, ...(add as MediaItem[]))
            )
          }
        : {})
    }
    raw.queue = queue
    const ids = (): string[] => queue.items.map((x) => x.id)
    return { p: new Player(music), ids, queue }
  }

  it('taşıma: yalnızca sıradakiler arasında; çalan, geçmiş ve otomatik çalma reddedilir', () => {
    const { p, ids } = setup()
    p.moveQueueItem(4, 2)
    expect(ids()).toEqual(['h', 'now', 'c', 'a', 'b', 'x', 'y'])
    p.moveQueueItem(2, 4)
    expect(ids()).toEqual(['h', 'now', 'a', 'b', 'c', 'x', 'y'])
    p.moveQueueItem(3, 3)
    for (const [from, to] of [
      [1, 3],
      [0, 2],
      [2, 5],
      [6, 2],
      [2, 1.5]
    ]) {
      expect(() => p.moveQueueItem(from!, to!)).toThrow(CoreError)
    }
    expect(ids()).toEqual(['h', 'now', 'a', 'b', 'c', 'x', 'y'])
  })

  it('çıkarma: sıradaki ve otomatik çalma öğesi çıkar; çalan ve geçmiş çıkarılamaz', () => {
    const { p, ids } = setup()
    p.removeQueueItem(3)
    p.removeQueueItem(5)
    expect(ids()).toEqual(['h', 'now', 'a', 'c', 'x'])
    expect(() => p.removeQueueItem(1)).toThrow(CoreError)
    expect(() => p.removeQueueItem(0)).toThrow(CoreError)
    expect(() => p.removeQueueItem(9)).toThrow(CoreError)
  })

  it('Temizle: kullanıcının sıradakileri gider; çalan ve otomatik çalma kalır', () => {
    const { p, ids } = setup()
    p.clearUpNext()
    expect(ids()).toEqual(['h', 'now', 'x', 'y'])
  })

  it('çevrilemeyen (görünmeyen) öğe sıraları kaydırmaz', () => {
    const { p, queue } = setup()
    queue.items.splice(3, 0, null as unknown as MediaItem)
    p.removeQueueItem(3) // görünen 3 = 'b'
    expect(queue.items.map((x) => x?.id ?? '∅')).toEqual(['h', 'now', 'a', '∅', 'c', 'x', 'y'])
  })

  it('MusicKit splice sunmuyorsa anlaşılır hata', () => {
    const { p } = setup(false)
    expect(() => p.removeQueueItem(2)).toThrow(
      expect.objectContaining({ code: 'PLAYER_UNAVAILABLE' })
    )
  })
})

describe('karıştırma açıkken başlangıç şarkısı (2026-10-15 hatası)', () => {
  /** Gerçek MusicKit gibi: karıştırma açıkken seçilen öğe başa gelir, konum `startWith`'te kalır. */
  function shuffledMusic() {
    const fake = fakeMusic()
    fake.raw.shuffleMode = ShuffleMode.songs
    fake.raw.setQueue.mockImplementation(async (options: unknown) => {
      const { songs, startWith = 0 } = options as { songs?: string[]; startWith?: number }
      const ids = songs ?? ['p0', 'p1', 'p2', 'p3']
      const target = ids[startWith]!
      const rest = ids.filter((id) => id !== target).reverse()
      fake.raw.queue = { items: [target, ...rest].map((id) => item({ id })), position: startWith }
      fake.raw.nowPlayingItemIndex = startWith
    })
    return fake
  }

  it('Popüler Parçalar: basılan şarkının yeni sırasından başlar (play değil changeToMediaAtIndex)', async () => {
    const { music, raw } = shuffledMusic()
    await new Player(music).playSongs(['a', 'b', 'c', 'd', 'e', 'f'], 4)
    expect(raw.queue.items[0]!.id).toBe('e')
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(0)
    expect(raw.play).not.toHaveBeenCalled()
  })

  it('albüm / playlist (id bilinmez): MusicKit’in başa koyduğu öğeden başlar', async () => {
    const { music, raw } = shuffledMusic()
    await new Player(music).playAlbum('1440', 2)
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(0)
  })

  it('albüm / playlist + hedef kimlik (2026-10-18): basılan şarkı nereye düştüyse oradan başlar', async () => {
    const { music, raw } = shuffledMusic()
    // MusicKit hedefi başa değil 1. sıraya koymuş olsun; kütüphane öğesi katalog id'siyle tanınır.
    raw.setQueue.mockImplementation(async () => {
      raw.queue = {
        items: [
          item({ id: 'i.9' }),
          item({ id: 'i.7', attributes: { name: 'Hedef', playParams: { catalogId: '777' } } }),
          item({ id: 'i.8' })
        ],
        position: 2
      }
      raw.nowPlayingItemIndex = 2
    })
    await new Player(music).playAlbum('l.1', 2, ['777'])
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(1)
    raw.changeToMediaAtIndex.mockClear()
    await new Player(music).playPlaylist('p.1', 2, ['i.7'])
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(1)
  })

  it('karıştırma kapalı + çalınamayan şarkılar kuyruktan atılmış (GTA VI, 2026-10-18): hedef aranır', async () => {
    const { music, raw } = fakeMusic()
    // Sayfada 6 şarkı; MusicKit 1. ve 3. sırayı (çıkmamış) atmış, konum yine startWith'te.
    raw.setQueue.mockImplementation(async () => {
      raw.queue = { items: ['s0', 's2', 's4', 's5'].map((id) => item({ id })), position: 3 }
      raw.nowPlayingItemIndex = 3
    })
    await new Player(music).playAlbum('a.1', 3, ['s3'])
    // s3 kuyrukta yok (çalınamaz): karıştırma kapalıyken MusicKit'in seçimine dokunulmaz.
    expect(raw.play).toHaveBeenCalledTimes(1)
    await new Player(music).playAlbum('a.1', 4, ['s4'])
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(2)
  })

  it('karıştırma kapalıyken ya da baştan çalarken dokunulmaz', async () => {
    const off = fakeMusic()
    off.raw.setQueue.mockImplementation(async (options: unknown) => {
      const { songs = [], startWith = 0 } = options as { songs?: string[]; startWith?: number }
      off.raw.queue = { items: songs.map((id) => item({ id })), position: startWith }
      off.raw.nowPlayingItemIndex = startWith
    })
    await new Player(off.music).playSongs(['a', 'b', 'c'], 2)
    expect(off.raw.play).toHaveBeenCalledTimes(1)
    expect(off.raw.changeToMediaAtIndex).not.toHaveBeenCalled()
    const first = shuffledMusic()
    await new Player(first.music).playSongs(['a', 'b', 'c'], 0)
    expect(first.raw.play).toHaveBeenCalledTimes(1)
  })

  it('geri yükleme: ilk çalış kayıtlı şarkının yeni sırasından, kayıtlı saniyeye sarılır', async () => {
    const { music, raw } = shuffledMusic()
    const p = new Player(music)
    await p.restoreQueue({ queue: ['a', 'b', 'c', 'd'], position: 3, currentTime: 42 })
    expect(raw.play).not.toHaveBeenCalled()
    // Gerçek MusicKit gibi: geçilen sıra çalan sıra olur.
    raw.changeToMediaAtIndex.mockImplementation(async (...args: unknown[]) => {
      raw.nowPlayingItemIndex = args[0] as number
    })
    await p.play()
    expect(raw.changeToMediaAtIndex).toHaveBeenCalledWith(0)
    expect(raw.seekToTime).toHaveBeenCalledWith(42)
    // İkinci play normal.
    await p.play()
    expect(raw.play).toHaveBeenCalledTimes(1)
  })

  it('geri yüklemeden sonra kullanıcı "sonraki"ye basarsa bekleyen başlangıç iptal olur', async () => {
    const { music, raw } = shuffledMusic()
    const p = new Player(music)
    await p.restoreQueue({ queue: ['a', 'b', 'c'], position: 2 })
    await p.next()
    await p.play()
    expect(raw.changeToMediaAtIndex).not.toHaveBeenCalled()
    expect(raw.play).toHaveBeenCalledTimes(1)
  })
})

describe('kesirli konum (preciseTime)', () => {
  const audio = (currentTime: number, paused = false) => ({ currentTime, paused })

  it('yuvarlanmış bildirime yakın çalan <audio> konumunu kullanır', () => {
    expect(preciseTime(2, [audio(1.851)])).toBe(1.851)
    // Önden yüklenmiş duraklatılmış öğe yerine çalan öğe.
    expect(preciseTime(2, [audio(2.2, true), audio(1.9)])).toBe(1.9)
    expect(preciseTime(2, [audio(2.2, true)])).toBe(2.2)
  })

  it('uyan öğe yoksa bildirilen konum döner', () => {
    expect(preciseTime(30, [audio(0), audio(Number.NaN)])).toBe(30)
    expect(preciseTime(30, [])).toBe(30)
  })

  it('Player konum olayında ve anlık durumda kesirli konumu yayınlar', () => {
    const { music, raw, fire } = fakeMusic()
    const p = new Player(music, { mediaElements: () => [audio(12.38)] })
    const times: unknown[] = []
    p.on('playbackTimeDidChange', (e) => times.push(e))
    raw.currentPlaybackTime = 12
    raw.currentPlaybackDuration = 200
    fire('playbackTimeDidChange')
    expect(times).toEqual([{ currentTime: 12.38, duration: 200 }])
    expect(p.snapshot().currentTime).toBe(12.38)
  })
})
