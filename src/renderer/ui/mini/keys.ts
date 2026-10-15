import type { PlayerCommand } from '@shared/ipc-contract'

/** MiniPlayer klavyesi: Boşluk çal / duraklat; ← / → önceki / sonraki. */
export function miniKeyCommand(code: string): PlayerCommand | null {
  switch (code) {
    case 'Space':
      return { type: 'togglePlay' }
    case 'ArrowLeft':
      return { type: 'previous' }
    case 'ArrowRight':
      return { type: 'next' }
    default:
      return null
  }
}
