import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PlayerCommand,
  PlayerHubSnapshot,
  PlayerHubState,
  PlayerTime
} from '@shared/ipc-contract'
import { PlayerHubStateSchema } from '@shared/ipc-contract'
import { TypedEmitter } from '../emitter'
import { frameThrottle } from '../frame'
import type { Player, PlayerEvents, PlayerSnapshot } from '../musickit/player'
import { connectPlayerToHub, executeCommand, toHubState, type HubPort } from './hubPublisher'
import { RemotePlayer, type RemoteHubPort } from './remotePlayer'

afterEach(() => vi.restoreAllMocks())

const nowPlaying = {
  id: '1',
  title: 'Şarkı',
  artist: 'Sanatçı',
  album: 'Albüm',
  artworkTemplate: 'https://is1.mzstatic.com/{w}x{h}bb.jpg',
  durationSec: 200,
  playbackType: 'encryptedFull' as const
}

function snapshot(over: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    state: 'playing',
    nowPlaying,
    currentTime: 10,
    duration: 200,
    volume: 0.8,
    shuffle: false,
    repeat: 'none',
    queue: { items: [nowPlaying, { ...nowPlaying, id: '2' }], position: 0, autoplayIndex: null },
    ...over
  }
}

class FakePlayer extends TypedEmitter<PlayerEvents> {
  snap = snapshot()
  calls: string[] = []
  snapshot = (): PlayerSnapshot => this.snap
  fire<K extends keyof PlayerEvents>(name: K, payload: PlayerEvents[K]): void {
    this.emit(name, payload)
  }
  play = vi.fn(async () => void this.calls.push('play'))
  pause = vi.fn(async () => void this.calls.push('pause'))
  stop = vi.fn(async () => {})
  next = vi.fn(async () => {})
  previous = vi.fn(async () => {})
  seek = vi.fn(async () => {})
  setVolume = vi.fn()
  setShuffle = vi.fn()
  setRepeat = vi.fn()
  playQueueIndex = vi.fn(async () => {})
}

function hubPort() {
  let commandListener: ((c: PlayerCommand) => void) | null = null
  const port = {
    publishState: vi.fn<(s: PlayerHubState) => Promise<null>>(async () => null),
    publishTime: vi.fn<(t: PlayerTime) => Promise<null>>(async () => null),
    onCommand: vi.fn((fn: (c: PlayerCommand) => void) => {
      commandListener = fn
      return () => void (commandListener = null)
    }),
    send: (c: PlayerCommand) => commandListener?.(c),
    get listening() {
      return commandListener !== null
    }
  }
  return port satisfies HubPort
}

describe('toHubState', () => {
  it('sözleşmeye uygun durum üretir (https kapak, kuyruk kimlikleri)', () => {
    const state = toHubState(snapshot())
    expect(PlayerHubStateSchema.safeParse(state).success).toBe(true)
    expect(state.nowPlaying?.artworkUrl).toBe('https://is1.mzstatic.com/512x512bb.jpg')
    expect(state.queue).toEqual({ ids: ['1', '2'], position: 0, autoplayIndex: null })
  })

  it('otomatik çalma başlangıcı yayınlanır; id elendiyse sıra kaymasın diye null (P3)', () => {
    const items = [nowPlaying, { ...nowPlaying, id: '2' }, { ...nowPlaying, id: '3' }]
    const state = toHubState(snapshot({ queue: { items, position: 0, autoplayIndex: 1 } }))
    expect(state.queue.autoplayIndex).toBe(1)
    expect(PlayerHubStateSchema.safeParse(state).success).toBe(true)
    const withBadId = [nowPlaying, { ...nowPlaying, id: '' }, { ...nowPlaying, id: '3' }]
    expect(
      toHubState(snapshot({ queue: { items: withBadId, position: 0, autoplayIndex: 2 } })).queue
        .autoplayIndex
    ).toBeNull()
  })

  it('https olmayan kapak null olur; sınır dışı değerler kırpılır', () => {
    const state = toHubState(
      snapshot({
        nowPlaying: { ...nowPlaying, artworkTemplate: 'http://x/{w}.jpg', durationSec: NaN },
        volume: 7,
        queue: { items: [], position: 4, autoplayIndex: null }
      })
    )
    expect(state.nowPlaying?.artworkUrl).toBeNull()
    expect(state.nowPlaying?.durationSec).toBe(0)
    expect(state.volume).toBe(1)
    expect(state.queue.position).toBe(0)
    expect(PlayerHubStateSchema.safeParse(state).success).toBe(true)
  })
})

describe('connectPlayerToHub', () => {
  it('bağlanınca ve ayrık değişikliklerde tam durumu yayınlar', () => {
    const player = new FakePlayer()
    const hub = hubPort()
    connectPlayerToHub(player as unknown as Player, hub)
    expect(hub.publishState).toHaveBeenCalledTimes(1)
    player.fire('playbackStateDidChange', { state: 'paused', previous: 'playing' })
    player.fire('settingsDidChange', { volume: 0.2, shuffle: true, repeat: 'all' })
    expect(hub.publishState).toHaveBeenCalledTimes(3)
  })

  it('konum ≤ 1/sn kısılır', () => {
    let t = 0
    const player = new FakePlayer()
    const hub = hubPort()
    connectPlayerToHub(player as unknown as Player, hub, { now: () => t })
    hub.publishTime.mockClear()
    for (t = 100; t <= 950; t += 250)
      player.fire('playbackTimeDidChange', { currentTime: t / 1000, duration: 200 })
    expect(hub.publishTime).not.toHaveBeenCalled()
    t = 1_000
    player.fire('playbackTimeDidChange', { currentTime: 1, duration: 200 })
    expect(hub.publishTime).toHaveBeenCalledTimes(1)
  })

  it('hub komutlarını Player üzerinde yürütür; söküldükten sonra dinlemez', async () => {
    const player = new FakePlayer()
    const hub = hubPort()
    const off = connectPlayerToHub(player as unknown as Player, hub)
    hub.send({ type: 'togglePlay' }) // playing → pause
    hub.send({ type: 'seek', seconds: 42 })
    await Promise.resolve()
    expect(player.pause).toHaveBeenCalled()
    expect(player.seek).toHaveBeenCalledWith(42)
    off()
    expect(hub.listening).toBe(false)
    player.fire('playbackStateDidChange', { state: 'paused', previous: 'playing' })
    expect(hub.publishState).toHaveBeenCalledTimes(1)
  })

  it('yayın hatası çalmayı etkilemez, bir kez loglanır', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const player = new FakePlayer()
    const hub = hubPort()
    hub.publishState.mockRejectedValue(new Error('ipc'))
    hub.publishTime.mockRejectedValue(new Error('ipc'))
    connectPlayerToHub(player as unknown as Player, hub)
    player.fire('nowPlayingItemDidChange', null)
    await new Promise((r) => setTimeout(r, 0))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('PLAY_002')
  })
})

describe('executeCommand', () => {
  it.each([
    [{ type: 'play' }, 'play'],
    [{ type: 'next' }, 'next'],
    [{ type: 'previous' }, 'previous'],
    [{ type: 'stop' }, 'stop'],
    [{ type: 'setVolume', volume: 0.3 }, 'setVolume'],
    [{ type: 'setShuffle', enabled: true }, 'setShuffle'],
    [{ type: 'setRepeat', mode: 'one' }, 'setRepeat'],
    [{ type: 'playQueueIndex', index: 3 }, 'playQueueIndex']
  ] as const)('%j → Player.%s', async (command, method) => {
    const player = new FakePlayer()
    await executeCommand(player as unknown as Player, command)
    expect(player[method]).toHaveBeenCalled()
  })

  it('togglePlay duraklatılmışken çalar', async () => {
    const player = new FakePlayer()
    player.snap = snapshot({ state: 'paused' })
    await executeCommand(player as unknown as Player, { type: 'togglePlay' })
    expect(player.play).toHaveBeenCalled()
  })
})

describe('RemotePlayer', () => {
  function remotePort(snap: PlayerHubSnapshot) {
    let onState: ((s: PlayerHubState) => void) | null = null
    let onTime: ((t: PlayerTime) => void) | null = null
    let resolveSnapshot!: (s: PlayerHubSnapshot) => void
    const port = {
      getState: vi.fn(() => new Promise<PlayerHubSnapshot>((r) => (resolveSnapshot = r))),
      onState: vi.fn((fn: (s: PlayerHubState) => void) => ((onState = fn), () => (onState = null))),
      onTime: vi.fn((fn: (t: PlayerTime) => void) => ((onTime = fn), () => (onTime = null))),
      command: vi.fn(async () => {}),
      pushState: (s: PlayerHubState) => onState?.(s),
      pushTime: (t: PlayerTime) => onTime?.(t),
      resolve: () => resolveSnapshot(snap),
      get subscribed() {
        return onState !== null && onTime !== null
      }
    }
    return port satisfies RemoteHubPort
  }

  const state = toHubState(snapshot())

  it('yeni pencere snapshot alır, sonra canlı güncellemeleri dinler', async () => {
    const port = remotePort({ state, time: { currentTime: 5, duration: 200 } })
    const remote = new RemotePlayer(port)
    const states: PlayerHubState[] = []
    remote.on('state', (s) => states.push(s))
    const started = remote.start()
    port.resolve()
    await started
    expect(remote.state).toEqual(state)
    expect(remote.time.currentTime).toBe(5)
    const paused = { ...state, playbackState: 'paused' as const }
    port.pushState(paused)
    expect(remote.state).toEqual(paused)
    expect(states).toHaveLength(2)
  })

  it('snapshot gelmeden önce gelen güncelleme eski snapshot tarafından ezilmez', async () => {
    const port = remotePort({ state, time: { currentTime: 5, duration: 200 } })
    const remote = new RemotePlayer(port)
    const started = remote.start()
    const newer = { ...state, volume: 0.1 }
    port.pushState(newer)
    port.pushTime({ currentTime: 50, duration: 200 })
    port.resolve()
    await started
    expect(remote.state).toEqual(newer)
    expect(remote.time.currentTime).toBe(50)
  })

  it('komutları hub’a gönderir; stop dinleyicileri söker', async () => {
    const port = remotePort({ state: null, time: { currentTime: 0, duration: 0 } })
    const remote = new RemotePlayer(port)
    const started = remote.start()
    port.resolve()
    await started
    expect(remote.state).toBeNull()
    await remote.command({ type: 'next' })
    expect(port.command).toHaveBeenCalledWith({ type: 'next' })
    remote.stop()
    expect(port.subscribed).toBe(false)
  })
})

describe('frameThrottle (1.8b)', () => {
  it('aynı karedeki çağrıları birleştirir, son değeri çizer; kare gelmezse çizmez', () => {
    const frames: (() => void)[] = []
    const draw = vi.fn()
    const update = frameThrottle(draw, (cb) => frames.push(cb))
    update(1)
    update(2)
    update(3)
    expect(draw).not.toHaveBeenCalled() // gizli pencere: kare yok → çizim yok
    expect(frames).toHaveLength(1)
    frames.shift()!()
    expect(draw).toHaveBeenCalledExactlyOnceWith(3)
    update(4)
    expect(frames).toHaveLength(1)
  })
})
