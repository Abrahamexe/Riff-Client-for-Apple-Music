import { describe, expect, it, vi } from 'vitest'
import type { WorkerApi } from '@shared/ipc-contract'
import { TypedEmitter } from '../emitter'
import type { NowPlaying, PlayerEvents, PlayerSnapshot } from '../musickit/player'
import { BackgroundClient, connectBackgroundPrefetch, toTrackRef } from './background'

const item = (id: string, over: Partial<NowPlaying> = {}): NowPlaying => ({
  id,
  title: `Şarkı ${id}`,
  artist: 'Sanatçı',
  album: 'Albüm',
  artworkTemplate: null,
  durationSec: 200.4,
  playbackType: 'encryptedFull',
  ...over
})

class FakePlayer extends TypedEmitter<PlayerEvents> {
  queue = {
    items: [item('1'), item('2', { isrc: 'GBUM71029604' })],
    position: 0,
    autoplayIndex: null as number | null
  }
  snapshot = () => ({ queue: this.queue }) as PlayerSnapshot
  fire<K extends keyof PlayerEvents>(name: K, payload: PlayerEvents[K]): void {
    this.emit(name, payload)
  }
}

describe('toTrackRef (3.A7)', () => {
  it('çalan öğeden eşleştirme girdisi: süre ms, ISRC varsa; kullanıcı bilgisi yok', () => {
    expect(toTrackRef(item('2', { isrc: 'GBUM71029604' }))).toEqual({
      title: 'Şarkı 2',
      artist: 'Sanatçı',
      album: 'Albüm',
      isrc: 'GBUM71029604',
      durationMs: 200_400
    })
  })

  it('katalog id appleId olarak eklenir (V8: worker ISRC çözer)', () => {
    expect(toTrackRef(item('i.1', { catalogId: '1440857781' }))).toMatchObject({
      appleId: '1440857781'
    })
    expect(toTrackRef(item('i.1'))).not.toHaveProperty('appleId')
  })

  it('başlık/sanatçı yoksa null; bozuk ISRC atlanır; boş albüm ve sıfır süre eklenmez', () => {
    expect(toTrackRef(null)).toBeNull()
    expect(toTrackRef(item('x', { title: '  ' }))).toBeNull()
    expect(toTrackRef(item('x', { isrc: 'bozuk', album: '', durationSec: 0 }))).toEqual({
      title: 'Şarkı x',
      artist: 'Sanatçı'
    })
  })
})

describe('sıradaki şarkı ön yüklemesi (3.A7)', () => {
  it('bağlanınca ve şarkı değişince SIRADAKİ şarkıyı ön yükler; aynısını tekrarlamaz', async () => {
    const player = new FakePlayer()
    const client = { prefetch: vi.fn(async () => {}) }
    const off = connectBackgroundPrefetch(player, client, { lang: () => 'tr' })
    expect(client.prefetch).toHaveBeenCalledTimes(1)
    expect(client.prefetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Şarkı 2', isrc: 'GBUM71029604' }),
      'tr'
    )
    player.fire('queueItemsDidChange', player.queue)
    expect(client.prefetch).toHaveBeenCalledTimes(1)

    player.queue = { items: [item('1'), item('2'), item('3')], position: 1, autoplayIndex: null }
    player.fire('nowPlayingItemDidChange', item('2'))
    expect(client.prefetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Şarkı 3' }),
      'tr'
    )

    // Kuyruğun sonu: sıradaki yok.
    player.queue = { ...player.queue, position: 2 }
    player.fire('nowPlayingItemDidChange', item('3'))
    expect(client.prefetch).toHaveBeenCalledTimes(2)

    off()
    player.queue = { items: [item('9'), item('10')], position: 0, autoplayIndex: null }
    player.fire('nowPlayingItemDidChange', item('9'))
    expect(client.prefetch).toHaveBeenCalledTimes(2)
    await Promise.resolve()
  })

  it('hata çalmayı etkilemez: bildirilir ve sonraki değişiklikte yeniden denenir', async () => {
    const player = new FakePlayer()
    const client = { prefetch: vi.fn(() => Promise.reject(new Error('worker yok'))) }
    const onError = vi.fn()
    connectBackgroundPrefetch(player, client, { lang: () => 'en', onError })
    await new Promise((r) => setTimeout(r, 0))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'BG_SOURCE_UNAVAILABLE' }))
    player.fire('queueItemsDidChange', player.queue)
    expect(client.prefetch).toHaveBeenCalledTimes(2)
  })
})

describe('BackgroundClient', () => {
  it('worker sonucunu açar; hata katalog kodlu CoreError olur', async () => {
    const api = {
      getBackground: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'BG_SOURCE_UNAVAILABLE', message: 'x' }
      })),
      prefetchBackground: vi.fn(async () => ({ ok: true as const, value: null })),
      onBackgroundChanged: vi.fn(() => () => {}),
      onBackgroundProgress: vi.fn(() => () => {})
    } as unknown as WorkerApi
    const client = new BackgroundClient(api)
    await expect(client.get({ title: 'a', artist: 'b' }, 'tr')).rejects.toMatchObject({
      code: 'BG_SOURCE_UNAVAILABLE',
      id: 'BG_002'
    })
    await expect(client.prefetch({ title: 'a', artist: 'b' }, 'tr')).resolves.toBeUndefined()
  })

  it('ilerleme: yalnızca kendi isteğinin aşamaları iletilir; dinleyici sonda (hatada da) sökülür (3.A8)', async () => {
    let listener: (p: unknown) => void = () => {}
    const off = vi.fn()
    const sent: { requestId?: string }[] = []
    const api = {
      onBackgroundProgress: vi.fn((l: (p: unknown) => void) => {
        listener = l
        return off
      }),
      getBackground: vi.fn(async (params: { requestId?: string }) => {
        sent.push(params)
        listener({ requestId: 'baska', stage: 'match' })
        listener({ requestId: params.requestId, stage: 'credits' })
        return {
          ok: false as const,
          error: { code: 'BG_CANCELLED', message: 'iptal' }
        }
      })
    } as unknown as WorkerApi
    const seen: string[] = []
    await expect(
      new BackgroundClient(api).get({ title: 'a', artist: 'b' }, 'tr', (p) => seen.push(p.stage))
    ).rejects.toMatchObject({ code: 'BG_CANCELLED', id: 'BG_008' })
    expect(sent[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(seen).toEqual(['credits'])
    expect(off).toHaveBeenCalledTimes(1)
  })
})
