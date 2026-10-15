import { describe, expect, it, vi } from 'vitest'
import type { PlayerHubState } from '@shared/ipc-contract'
import { PlayerHub } from './player-hub'
import { WindowRegistry, type WindowLike } from './windows'

type Event = 'closed' | 'show' | 'restore'

function fakeWindow(id: number, { url = 'app://renderer/index.html', routingId = id } = {}) {
  const handlers: Partial<Record<Event, (() => void)[]>> = {}
  const state = { visible: true, minimized: false, destroyed: false }
  const send = vi.fn()
  const win = {
    id,
    state,
    send,
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    show: vi.fn(() => void (state.visible = true)),
    restore: vi.fn(() => void (state.minimized = false)),
    focus: vi.fn(),
    on: (event: Event, fn: () => void) => void (handlers[event] ??= []).push(fn),
    fire: (event: Event) => handlers[event]?.forEach((fn) => fn()),
    webContents: { send, getURL: () => url, mainFrame: { processId: 1, routingId } }
  }
  return win satisfies WindowLike
}

const TIME = { currentTime: 5, duration: 100 }
const STATE: PlayerHubState = {
  playbackState: 'playing',
  nowPlaying: null,
  volume: 1,
  shuffle: false,
  repeat: 'none',
  queue: { ids: ['a', 'b', 'c'], position: 2, autoplayIndex: null }
}

describe('WindowRegistry', () => {
  it('ana pencere çerçevesini kimliğiyle tanır', () => {
    const reg = new WindowRegistry()
    reg.register(fakeWindow(1), 'main')
    reg.register(fakeWindow(2), 'aux')
    expect(reg.isMainWindowFrame({ processId: 1, routingId: 1 })).toBe(true)
    expect(reg.isMainWindowFrame({ processId: 1, routingId: 2 })).toBe(false)
    expect(reg.isMainWindowFrame({ processId: 9, routingId: 1 })).toBe(false)
  })

  it('ikinci ana pencere kaydedilemez; kapanan pencere kayıttan düşer', () => {
    const reg = new WindowRegistry()
    const main = fakeWindow(1)
    reg.register(main, 'main')
    expect(() => reg.register(fakeWindow(2), 'main')).toThrow()
    main.fire('closed')
    expect(reg.main()).toBeNull()
  })

  it('yayın yalnızca kendi içeriğimize gider; visibleOnly gizli/küçültülmüşleri atlar', () => {
    const reg = new WindowRegistry()
    const visible = fakeWindow(1)
    const hidden = fakeWindow(2)
    const minimized = fakeWindow(3)
    const foreign = fakeWindow(4, { url: 'https://authorize.music.apple.com/' })
    hidden.state.visible = false
    minimized.state.minimized = true
    for (const w of [visible, hidden, minimized, foreign])
      reg.register(w, w.id === 1 ? 'main' : 'aux')

    reg.broadcast('onPlayerTime', TIME, { visibleOnly: true })
    expect(visible.send).toHaveBeenCalledWith('player:time', TIME)
    expect(hidden.send).not.toHaveBeenCalled()
    expect(minimized.send).not.toHaveBeenCalled()

    reg.broadcast('onCdmStatus', { state: 'ready' })
    expect(hidden.send).toHaveBeenCalledWith('cdm:status', { state: 'ready' })
    expect(foreign.send).not.toHaveBeenCalled()
  })

  it('showMain küçültülmüş pencereyi geri getirir', () => {
    const reg = new WindowRegistry()
    expect(reg.showMain()).toBe(false)
    const main = fakeWindow(1)
    main.state.minimized = true
    reg.register(main, 'main')
    expect(reg.showMain()).toBe(true)
    expect(main.restore).toHaveBeenCalled()
    expect(main.focus).toHaveBeenCalled()
  })
})

describe('PlayerHub', () => {
  function setup() {
    const reg = new WindowRegistry()
    const main = fakeWindow(1)
    const aux = fakeWindow(2)
    reg.register(main, 'main')
    reg.register(aux, 'aux')
    return { reg, main, aux, hub: new PlayerHub(reg) }
  }

  it('durum tüm pencerelere, konum yalnızca görünürlere gider; snapshot son durumu verir', () => {
    const { hub, main, aux } = setup()
    aux.state.visible = false
    hub.publishState(STATE)
    hub.publishTime(TIME)
    expect(aux.send).toHaveBeenCalledWith('player:state', STATE)
    expect(aux.send).not.toHaveBeenCalledWith('player:time', TIME)
    expect(main.send).toHaveBeenCalledWith('player:time', TIME)
    expect(hub.snapshot()).toEqual({ state: STATE, time: TIME })
  })

  it('gizli pencere tekrar görünür olunca güncel snapshot alır (1.8b)', () => {
    const { hub, aux } = setup()
    aux.state.visible = false
    hub.publishState(STATE)
    hub.publishTime(TIME)
    aux.send.mockClear()
    aux.state.visible = true
    aux.fire('show')
    expect(aux.send).toHaveBeenCalledWith('player:state', STATE)
    expect(aux.send).toHaveBeenCalledWith('player:time', TIME)
  })

  it('komut yalnızca ana pencereye iletilir; ana pencere yoksa PLAYER_UNAVAILABLE', () => {
    const { hub, main, aux } = setup()
    hub.publishState(STATE)
    hub.command({ type: 'next' })
    expect(main.send).toHaveBeenCalledWith('player:runCommand', { type: 'next' })
    expect(aux.send).not.toHaveBeenCalledWith('player:runCommand', expect.anything())
    main.state.destroyed = true
    expect(() => hub.command({ type: 'play' })).toThrow(
      expect.objectContaining({ code: 'PLAYER_UNAVAILABLE' })
    )
  })

  it('MusicKit durum yayınlamadıysa veya reset sonrası komut PLAYER_NOT_READY; iletilmez (1.8c)', () => {
    const { hub, main } = setup()
    const notReady = expect.objectContaining({ code: 'PLAYER_NOT_READY' })
    expect(() => hub.command({ type: 'play' })).toThrow(notReady)
    hub.publishState(STATE)
    hub.reset()
    expect(() => hub.command({ type: 'next' })).toThrow(notReady)
    expect(main.send).not.toHaveBeenCalledWith('player:runCommand', expect.anything())
  })

  it('CDM hazır değilken komut PLAYER_NOT_READY; hazır olunca iletilir (1.8c)', () => {
    const reg = new WindowRegistry()
    const main = fakeWindow(1)
    reg.register(main, 'main')
    let cdmReady = false
    const hub = new PlayerHub(reg, { isCdmReady: () => cdmReady })
    hub.publishState(STATE)
    expect(() => hub.command({ type: 'togglePlay' })).toThrow(
      expect.objectContaining({ code: 'PLAYER_NOT_READY' })
    )
    expect(main.send).not.toHaveBeenCalledWith('player:runCommand', expect.anything())
    cdmReady = true
    hub.command({ type: 'togglePlay' })
    expect(main.send).toHaveBeenCalledWith('player:runCommand', { type: 'togglePlay' })
  })

  it('kaydedilecek durum: kuyruk + konum; boş kuyrukta veya reset sonrası null', () => {
    const { hub } = setup()
    expect(hub.persistableState()).toBeNull()
    hub.publishState(STATE)
    hub.publishTime(TIME)
    expect(hub.persistableState()).toEqual({ queue: ['a', 'b', 'c'], position: 2, currentTime: 5 })
    hub.reset()
    expect(hub.persistableState()).toBeNull()
    hub.publishState({ ...STATE, queue: { ids: [], position: 0, autoplayIndex: null } })
    expect(hub.persistableState()).toBeNull()
  })
})
