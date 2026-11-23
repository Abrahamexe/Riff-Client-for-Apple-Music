import { useEffect, useState } from 'react'
import { frameThrottle } from '@core/frame'
import type { NowPlaying, Player, PlayerSnapshot } from '@core/musickit/player'
import { useApp } from '../context'

// Çalar durumu (B2): App'in Player'ı hazır olunca abone olunur. Konum güncellemesi kare hızında
// kısılır; pencere gizliyken çizim durur (1.8b).

export interface PlayerView {
  player: Player | null
  snapshot: PlayerSnapshot | null
  currentTime: number
  duration: number
}

export function usePlayer(): PlayerView {
  const app = useApp()
  const [player, setPlayer] = useState<Player | null>(app.hasPlayer ? app.player : null)
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(
    app.hasPlayer ? app.player.snapshot() : null
  )
  const [time, setTime] = useState({ currentTime: 0, duration: 0 })

  useEffect(() => app.on('playerReady', setPlayer), [app])

  useEffect(() => {
    if (!player) return
    const refresh = (): void => setSnapshot(player.snapshot())
    // MusicKit kuyruk öğelerinin ayrıntılarını (kapak, ad) kuyruk kurulduktan biraz sonra doldurur ve
    // bunun için olay yayınlamaz (B3 gözlemi): kuyruk değişince kısa aralıklarla bir kez daha okunur.
    const timers: ReturnType<typeof setTimeout>[] = []
    const onQueue = (): void => {
      refresh()
      for (const t of timers.splice(0)) clearTimeout(t)
      timers.push(setTimeout(refresh, 1_500), setTimeout(refresh, 4_000))
    }
    refresh()
    const offs = [
      player.on('playbackStateDidChange', refresh),
      player.on('nowPlayingItemDidChange', refresh),
      player.on('queueItemsDidChange', onQueue),
      player.on('settingsDidChange', refresh),
      player.on('playbackTimeDidChange', frameThrottle(setTime))
    ]
    return () => {
      offs.forEach((off) => off())
      timers.forEach(clearTimeout)
    }
  }, [player])

  return { player, snapshot, currentTime: time.currentTime, duration: time.duration }
}

/** Çubukta gösterilecek şarkı: çalan; kuyruk kurulup henüz başlamadıysa sıradaki ilk şarkı. */
export function displayedTrack(snapshot: PlayerSnapshot | null): NowPlaying | null {
  if (!snapshot) return null
  if (snapshot.nowPlaying) return snapshot.nowPlaying
  const { items, position } = snapshot.queue
  return items[Math.max(0, position)] ?? null
}

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
