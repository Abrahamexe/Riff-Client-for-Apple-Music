import type { HubNowPlaying, PlayerCommand, PlayerHubState, PlayerTime } from '@shared/ipc-contract'
import { logError } from '../errors'
import {
  resolveArtwork,
  type NowPlaying,
  type Player,
  type PlayerSnapshot
} from '../musickit/player'

// Ana pencere (MusicKit) → main player-hub köprüsü (PLAN 1.8a). Player'ın durumu ayrık
// değişikliklerde tam olarak, konum ise kısılarak (varsayılan ≤ 1/sn) yayınlanır; hub'dan gelen
// komutlar burada Player üzerinde yürütülür. UI'dan ve `window.api`'den bağımsızdır (HubPort).

/** Main'deki hub'a erişim (uygulamada preload → IPC; renderer/playerHub.ts). */
export interface HubPort {
  publishState(state: PlayerHubState): Promise<unknown>
  publishTime(time: PlayerTime): Promise<unknown>
  /** Hub'dan gelen komutları dinler; abonelikten çıkan fonksiyon döner. */
  onCommand(listener: (command: PlayerCommand) => void): () => void
}

export interface HubPublisherOptions {
  /** Konum yayınları arasındaki en kısa süre. */
  timeIntervalMs?: number
  now?: () => number
}

const MAX_QUEUE = 5_000
const MAX_SECONDS = 86_400

const clampSeconds = (s: number): number =>
  Number.isFinite(s) ? Math.min(Math.max(0, s), MAX_SECONDS) : 0

/** Kapak URL'si yalnızca https ise (sözleşme ve ileride <img src>). */
function httpsArtwork(template: string | null): string | null {
  const url = resolveArtwork(template, 512)
  return url?.startsWith('https://') ? url : null
}

function toHubNowPlaying(item: NowPlaying | null): HubNowPlaying | null {
  if (!item || item.id.trim() === '') return null
  const text = (s: string): string => s.slice(0, 1_000)
  return {
    id: item.id.slice(0, 256),
    title: text(item.title),
    artist: text(item.artist),
    album: text(item.album),
    artworkUrl: httpsArtwork(item.artworkTemplate),
    durationSec: clampSeconds(item.durationSec),
    playbackType: item.playbackType
  }
}

/** Player anlık görüntüsü → sözleşmedeki hub durumu (sınırlar sözleşmeyle aynıdır). */
export function toHubState(snapshot: PlayerSnapshot): PlayerHubState {
  const ids = snapshot.queue.items
    .slice(0, MAX_QUEUE)
    .map((i) => i.id)
    .filter((id) => id !== '' && id.length <= 256)
  return {
    playbackState: snapshot.state,
    nowPlaying: toHubNowPlaying(snapshot.nowPlaying),
    volume: Math.min(1, Math.max(0, Number.isFinite(snapshot.volume) ? snapshot.volume : 1)),
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat,
    queue: {
      ids,
      position: Math.min(Math.max(0, snapshot.queue.position), Math.max(0, ids.length - 1)),
      autoplayIndex: autoplayIndexWithin(snapshot.queue, ids.length)
    }
  }
}

/**
 * Otomatik çalma başlangıcı, yayınlanan id listesine göre. Liste kesildiyse veya bir id elendiyse
 * sıra kayabileceği için yalnızca güvenli durumda verilir (aksi `null`: bölüm başlığı gösterilmez).
 */
function autoplayIndexWithin(
  queue: PlayerSnapshot['queue'],
  publishedCount: number
): number | null {
  const index = queue.autoplayIndex
  if (index === null || publishedCount !== queue.items.length) return null
  return index >= 0 && index < publishedCount ? index : null
}

function toHubTime(time: { currentTime: number; duration: number }): PlayerTime {
  return { currentTime: clampSeconds(time.currentTime), duration: clampSeconds(time.duration) }
}

/** Hub komutunu Player üzerinde yürütür. Hatalar Player `error` event'i olarak zaten yayınlanır. */
export async function executeCommand(player: Player, command: PlayerCommand): Promise<void> {
  switch (command.type) {
    case 'play':
      return player.play()
    case 'pause':
      return player.pause()
    case 'togglePlay':
      return player.snapshot().state === 'playing' ? player.pause() : player.play()
    case 'stop':
      return player.stop()
    case 'next':
      return player.next()
    case 'previous':
      return player.previous()
    case 'seek':
      return player.seek(command.seconds)
    case 'setVolume':
      return player.setVolume(command.volume)
    case 'setShuffle':
      return player.setShuffle(command.enabled)
    case 'setRepeat':
      return player.setRepeat(command.mode)
    case 'playQueueIndex':
      return player.playQueueIndex(command.index)
  }
}

/** Player'ı hub'a bağlar; döndürülen fonksiyon tüm dinleyicileri söker. */
export function connectPlayerToHub(
  player: Player,
  hub: HubPort,
  { timeIntervalMs = 1_000, now = Date.now }: HubPublisherOptions = {}
): () => void {
  // Yayın hataları (ör. main yeniden başlıyor) çalmayı etkilemez; bir kez loglanır.
  let reported = false
  const report = (err: unknown): void => {
    if (reported) return
    reported = true
    logError('player-hub', err, 'PLAYER_UNAVAILABLE', 'Player durumu hub’a yayınlanamadı.')
  }

  let lastTime = Number.NEGATIVE_INFINITY
  const publishTime = (time: { currentTime: number; duration: number }): void => {
    lastTime = now()
    hub.publishTime(toHubTime(time)).catch(report)
  }
  const publishState = (): void => {
    const snapshot = player.snapshot()
    hub.publishState(toHubState(snapshot)).catch(report)
    // Durum değişince (ör. duraklatma, şarkı geçişi) konum da hemen eşitlenir.
    publishTime(snapshot)
  }

  const offs = [
    player.on('playbackStateDidChange', publishState),
    player.on('nowPlayingItemDidChange', publishState),
    player.on('queueItemsDidChange', publishState),
    player.on('settingsDidChange', publishState),
    player.on('playbackTimeDidChange', (time) => {
      if (now() - lastTime >= timeIntervalMs) publishTime(time)
    }),
    hub.onCommand((command) => {
      executeCommand(player, command).catch(() => {
        /* hata Player 'error' event'i olarak zaten yayınlandı */
      })
    })
  ]
  publishState() // bağlanır bağlanmaz ilk durum
  return () => offs.forEach((off) => off())
}
