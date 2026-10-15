import type { Card } from '@shared/ipc-contract'
import type { Player } from '@core/musickit/player'

/** Karttaki çal düğmesi: içeriğin türüne göre MusicKit kuyruğu; çalınamıyorsa `undefined`. */
export function playAction(player: Player | null, c: Card): (() => void) | undefined {
  if (!player) return undefined
  const run = (p: Promise<void>): void => void p.catch(() => {})
  switch (c.kind) {
    case 'album':
      return () => run(player.playAlbum(c.id))
    case 'playlist':
      return () => run(player.playPlaylist(c.id))
    case 'station':
      return () => run(player.playStation(c.id))
    case 'song':
      return () => run(player.playSong(c.playParams?.id ?? c.id))
    default:
      return undefined
  }
}
