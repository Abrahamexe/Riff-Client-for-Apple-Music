import type { PlaybackStateName, Player } from './player'
import { resolveArtwork } from './player'

// Windows medya tuşları ve SMTC overlay'i için Media Session API köprüsü (PLAN 1.8).
// Başlık, sanatçı ve kapak bilgisini aktarır; medya tuşlarını Player'a bağlar.

const SEEK_STEP_SECONDS = 10
const POSITION_UPDATE_MS = 1000

const toSessionState = (state: PlaybackStateName): MediaSessionPlaybackState => {
  switch (state) {
    case 'playing':
    case 'loading':
    case 'waiting':
    case 'stalled':
    case 'seeking':
      return 'playing'
    case 'paused':
      return 'paused'
    default:
      return 'none'
  }
}

/** Media Session'ı Player'a bağlar. Döndürülen fonksiyon bağlantıyı söker. */
export function bindMediaSession(
  player: Player,
  session: MediaSession | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.mediaSession
): () => void {
  if (!session) return () => {}

  const offs: (() => void)[] = []
  let lastPositionUpdate = 0

  offs.push(
    player.on('nowPlayingItemDidChange', (item) => {
      if (!item) {
        session.metadata = null
        return
      }
      const art = resolveArtwork(item.artworkTemplate, 512)
      session.metadata = new MediaMetadata({
        title: item.title,
        artist: item.artist,
        album: item.album,
        artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : []
      })
    })
  )

  offs.push(
    player.on('playbackStateDidChange', ({ state }) => {
      session.playbackState = toSessionState(state)
    })
  )

  offs.push(
    player.on('playbackTimeDidChange', ({ currentTime, duration }) => {
      const now = Date.now()
      if (now - lastPositionUpdate < POSITION_UPDATE_MS) return
      lastPositionUpdate = now
      if (!Number.isFinite(duration) || duration <= 0) return
      try {
        session.setPositionState({
          duration,
          position: Math.min(Math.max(0, currentTime), duration),
          playbackRate: 1
        })
      } catch {
        // Tarayıcı tutarsız değeri reddederse (ör. konum > süre) sessizce geç.
      }
    })
  )

  const swallow = (p: Promise<void>): void => void p.catch(() => {}) // hata zaten Player 'error' event'i olarak yayınlanır
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => swallow(player.play())],
    ['pause', () => swallow(player.pause())],
    ['stop', () => swallow(player.stop())],
    ['previoustrack', () => swallow(player.previous())],
    ['nexttrack', () => swallow(player.next())],
    [
      'seekto',
      (d) => {
        if (d.seekTime !== undefined && d.seekTime !== null) swallow(player.seek(d.seekTime))
      }
    ],
    [
      'seekbackward',
      (d) =>
        swallow(player.seek(player.snapshot().currentTime - (d.seekOffset ?? SEEK_STEP_SECONDS)))
    ],
    [
      'seekforward',
      (d) =>
        swallow(player.seek(player.snapshot().currentTime + (d.seekOffset ?? SEEK_STEP_SECONDS)))
    ]
  ]
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler)
      offs.push(() => session.setActionHandler(action, null))
    } catch {
      // Desteklenmeyen eylem: yoksay.
    }
  }

  return () => offs.forEach((off) => off())
}
