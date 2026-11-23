import { describe, expect, it, vi } from 'vitest'
import { TypedEmitter } from '../emitter'
import type { Player, PlayerEvents, PlayerSnapshot } from '../musickit/player'
import { persistPlayerState, restorePlayerState, toPlayerState, unresolvedIds } from './playerState'

class FakePlayer extends TypedEmitter<PlayerEvents> {
  snap: PlayerSnapshot = {
    state: 'playing',
    nowPlaying: null,
    currentTime: 42.5,
    duration: 200,
    volume: 1,
    shuffle: false,
    repeat: 'none',
    queue: { items: [item('a'), item('b')], position: 1, autoplayIndex: null }
  }
  restoreQueue = vi.fn(async () => {})
  snapshot = (): PlayerSnapshot => this.snap
  fire<K extends keyof PlayerEvents>(k: K, p: PlayerEvents[K]): void {
    this.emit(k, p)
  }
}

function item(id: string) {
  return {
    id,
    title: id,
    artist: '',
    album: '',
    artworkTemplate: null,
    durationSec: 1,
    playbackType: 'encryptedFull' as const
  }
}

describe('toPlayerState', () => {
  it('kuyruk id’leri, sıra ve konumu çıkarır; sınırlara kırpar', () => {
    const p = new FakePlayer()
    expect(toPlayerState(p.snap)).toEqual({ queue: ['a', 'b'], position: 1, currentTime: 42.5 })
    p.snap = { ...p.snap, currentTime: -3, queue: { items: [], position: 4, autoplayIndex: null } }
    expect(toPlayerState(p.snap)).toEqual({ queue: [], position: 0, currentTime: 0 })
  })
})

describe('persistPlayerState', () => {
  it('kuyruk değişince ve duraklatınca hemen, çalarken aralıkla kaydeder', () => {
    const p = new FakePlayer()
    const store = { savePlayerState: vi.fn(async () => {}) }
    let t = 0
    const off = persistPlayerState(p as unknown as Player, store, {
      intervalMs: 10_000,
      now: () => t
    })

    p.fire('queueItemsDidChange', { items: [], position: 0, autoplayIndex: null })
    expect(store.savePlayerState).toHaveBeenCalledTimes(1)

    t = 5_000
    p.fire('playbackTimeDidChange', { currentTime: 5, duration: 200 })
    expect(store.savePlayerState).toHaveBeenCalledTimes(1)
    t = 10_000
    p.fire('playbackTimeDidChange', { currentTime: 10, duration: 200 })
    expect(store.savePlayerState).toHaveBeenCalledTimes(2)

    p.fire('playbackStateDidChange', { state: 'paused', previous: 'playing' })
    expect(store.savePlayerState).toHaveBeenCalledTimes(3)

    off()
    p.fire('queueItemsDidChange', { items: [], position: 0, autoplayIndex: null })
    expect(store.savePlayerState).toHaveBeenCalledTimes(3)
  })

  it('kaydetme hatası dışarı sızmaz, onError’a iletilir', async () => {
    const p = new FakePlayer()
    const onError = vi.fn()
    const store = { savePlayerState: vi.fn(async () => Promise.reject(new Error('worker yok'))) }
    persistPlayerState(p as unknown as Player, store, { onError })
    p.fire('queueItemsDidChange', { items: [], position: 0, autoplayIndex: null })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
  })
})

describe('restorePlayerState', () => {
  it('kayıt varsa kuyruğu çalmadan geri yükler; yoksa dokunmaz', async () => {
    const p = new FakePlayer()
    const state = { queue: ['a', 'b'], position: 1, currentTime: 3 }
    expect(
      await restorePlayerState(p as unknown as Player, { loadPlayerState: async () => state })
    ).toBe(true)
    expect(p.restoreQueue).toHaveBeenCalledWith(state)
    expect(
      await restorePlayerState(p as unknown as Player, { loadPlayerState: async () => null })
    ).toBe(false)
    expect(p.restoreQueue).toHaveBeenCalledTimes(1)
  })
})

describe('restorePlayerState — çözülemeyen şarkılar (2026-10-14 hatası)', () => {
  const apple = (ids: string) =>
    new Error(`Kuyruk geri yüklenemedi. — One or more items could not be resolved: ${ids}`)

  it('hata metninden kimlikler', () => {
    expect(unresolvedIds(apple('1859497440'))).toEqual(['1859497440'])
    expect(unresolvedIds(apple('1, i.abc'))).toEqual(['1', 'i.abc'])
    expect(unresolvedIds(new Error('ağ yok'))).toEqual([])
    // Gerçek biçim: CoreError mesajı genel, Apple metni `cause`'ta.
    const wrapped = new Error('Kuyruk geri yüklenemedi.', {
      cause: new Error('One or more items could not be resolved: 1859497440')
    })
    expect(unresolvedIds(wrapped)).toEqual(['1859497440'])
  })

  it('çözülemeyenler atılıp yeniden denenir; çalan atıldıysa sonrakinden baştan', async () => {
    const p = new FakePlayer()
    p.restoreQueue = vi.fn().mockRejectedValueOnce(apple('b')).mockResolvedValueOnce(undefined)
    const state = { queue: ['a', 'b', 'c'], position: 1, currentTime: 30 }
    const ok = await restorePlayerState(p as unknown as Player, {
      loadPlayerState: async () => state
    })
    expect(ok).toBe(true)
    expect(p.restoreQueue).toHaveBeenLastCalledWith({
      queue: ['a', 'c'],
      position: 1,
      currentTime: 0
    })
  })

  it('çalan şarkı korunduysa konum ve süre korunur', async () => {
    const p = new FakePlayer()
    p.restoreQueue = vi.fn().mockRejectedValueOnce(apple('a')).mockResolvedValueOnce(undefined)
    const state = { queue: ['a', 'b', 'c'], position: 2, currentTime: 30 }
    await restorePlayerState(p as unknown as Player, { loadPlayerState: async () => state })
    expect(p.restoreQueue).toHaveBeenLastCalledWith({
      queue: ['b', 'c'],
      position: 1,
      currentTime: 30
    })
  })

  it('başka hata ya da ikinci deneme de başarısızsa false; ASLA fırlatmaz', async () => {
    const errors: unknown[] = []
    const p = new FakePlayer()
    p.restoreQueue = vi.fn().mockRejectedValue(new Error('ağ yok'))
    const state = { queue: ['a'], position: 0, currentTime: 0 }
    expect(
      await restorePlayerState(
        p as unknown as Player,
        { loadPlayerState: async () => state },
        (e) => errors.push(e)
      )
    ).toBe(false)
    p.restoreQueue = vi.fn().mockRejectedValue(apple('x'))
    expect(
      await restorePlayerState(
        p as unknown as Player,
        {
          loadPlayerState: async () => ({ queue: ['a', 'x'], position: 0, currentTime: 0 })
        },
        (e) => errors.push(e)
      )
    ).toBe(false)
    expect(
      await restorePlayerState(p as unknown as Player, {
        loadPlayerState: () => Promise.reject(new Error('db'))
      })
    ).toBe(false)
    expect(errors).toHaveLength(2)
  })
})

describe('toPlayerState — otomatik çalma (PLAN_v5 P3, B-e)', () => {
  const ids = ['u1', 'u2', 'a1', 'a2', 'a3']
  const snap = (position: number, autoplayIndex: number | null): PlayerSnapshot => ({
    state: 'paused',
    nowPlaying: null,
    currentTime: 5,
    duration: 200,
    volume: 1,
    shuffle: false,
    repeat: 'none',
    queue: { items: ids.map(item), position, autoplayIndex }
  })

  it('çalınmamış otomatik çalma öğeleri kaydedilmez (geri yüklemede Apple yeniden üretir)', () => {
    expect(toPlayerState(snap(1, 2))).toMatchObject({ queue: ['u1', 'u2'], position: 1 })
  })

  it('otomatik çalmadan bir şarkı çalıyorsa ona kadar kaydedilir; konum korunur', () => {
    expect(toPlayerState(snap(3, 2))).toMatchObject({
      queue: ['u1', 'u2', 'a1', 'a2'],
      position: 3
    })
  })

  it('otomatik çalma yoksa tüm kuyruk', () => {
    expect(toPlayerState(snap(0, null)).queue).toEqual(ids)
  })
})
