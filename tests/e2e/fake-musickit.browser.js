// E2E için sahte MusicKit JS v3 (PLAN 2.6). Harness, js-cdn.music.apple.com/musickit/v3/musickit.js
// isteğini bu dosyayla yanıtlar: testler Apple'a, ağa ve geliştiricinin hesabına dokunmaz. Yalnızca
// uygulamanın kullandığı yüzey taklit edilir (core/musickit/types.ts). Çalma: zamanlayıcıyla ilerleyen
// sahte konum; şarkı bitince sıradakine geçer.
;(() => {
  const State = { none: 0, loading: 1, playing: 2, paused: 3, stopped: 4, ended: 5, waiting: 8 }
  const listeners = new Map()
  const emit = (name, payload) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(payload)
  }
  const item = (id, i) => ({
    id,
    title: `E2E Şarkı ${i + 1}`,
    // Sanatçı boş: arka plan ön yüklemesi (MusicBrainz) tetiklenmez — testler ağa çıkmaz.
    artistName: '',
    albumName: 'E2E Albüm',
    playbackType: 3,
    playbackDuration: 180_000,
    attributes: { name: `E2E Şarkı ${i + 1}`, artistName: '', albumName: 'E2E Albüm' }
  })
  let timer = null
  const instance = {
    isAuthorized: false,
    musicUserToken: undefined,
    restrictedEnabled: undefined,
    storefrontId: 'us',
    playbackState: State.none,
    volume: 1,
    shuffleMode: 0,
    repeatMode: 0,
    currentPlaybackTime: 0,
    currentPlaybackDuration: 0,
    nowPlayingItemIndex: -1,
    queue: { items: [], position: -1 },
    get nowPlayingItem() {
      return this.queue.items[this.queue.position]
    },
    api: { music: async () => ({ data: { data: [], results: {} } }) },
    me: async () => ({ subscription: { storefront: 'us' } }),
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(fn)
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    authorize: async () => 'e2e-user-token',
    unauthorize: async () => {
      instance.musicUserToken = undefined
    },
    setState(next) {
      if (instance.playbackState === next) return
      instance.playbackState = next
      emit('playbackStateDidChange', { state: next })
    },
    async setQueue(options) {
      const ids = options.songs ?? (options.song ? [options.song] : ['e2e-1', 'e2e-2', 'e2e-3'])
      instance.queue = {
        items: ids.map(item),
        position: Math.min(options.startWith ?? 0, ids.length - 1)
      }
      instance.nowPlayingItemIndex = instance.queue.position
      instance.currentPlaybackTime = 0
      instance.currentPlaybackDuration = 180
      emit('queueItemsDidChange', {})
      emit('nowPlayingItemDidChange', {})
      if (options.startPlaying) await instance.play()
    },
    async play() {
      if (instance.queue.items.length === 0) return
      instance.setState(State.playing)
      clearInterval(timer)
      timer = setInterval(() => {
        instance.currentPlaybackTime += 1
        emit('playbackTimeDidChange', {})
      }, 1000)
    },
    pause() {
      clearInterval(timer)
      instance.setState(State.paused)
    },
    async stop() {
      clearInterval(timer)
      instance.currentPlaybackTime = 0
      instance.setState(State.stopped)
    },
    async changeToMediaAtIndex(i) {
      instance.queue.position = i
      instance.nowPlayingItemIndex = i
      instance.currentPlaybackTime = 0
      emit('queuePositionDidChange', {})
      emit('nowPlayingItemDidChange', {})
      await instance.play()
    },
    skipToNextItem: () =>
      instance.changeToMediaAtIndex(
        Math.min(instance.queue.position + 1, instance.queue.items.length - 1)
      ),
    skipToPreviousItem: () =>
      instance.changeToMediaAtIndex(Math.max(instance.queue.position - 1, 0)),
    async seekToTime(t) {
      instance.currentPlaybackTime = t
      emit('playbackTimeDidChange', {})
    }
  }
  let configured = false
  window.MusicKit = {
    configure: async () => {
      configured = true
      return instance
    },
    getInstance: () => (configured ? instance : undefined),
    PlaybackStates: State
  }
  document.dispatchEvent(new Event('musickitloaded'))
})()
