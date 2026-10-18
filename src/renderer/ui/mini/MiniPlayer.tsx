import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Maximize2,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { PlayerCommand, PlayerHubState, PlayerTime } from '@shared/ipc-contract'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import { RemotePlayer, type RemoteHubPort } from '@core/player/remotePlayer'
import { useSmoothTime } from '../hooks/smoothTime'
import { usePendingSeek } from '../hooks/pendingSeek'
import { usePointerRange } from '../hooks/pointerRange'
import { miniKeyCommand } from './keys'

// MiniPlayer (B12b, geliştirici kararı 2026-10-14): kare pencere, kapak tüm pencereyi kaplar.
// Kontroller (ad, sanatçı, ⏮ ▶ ⏭, ilerleme) üzerine gelince alttan cam katman olarak çıkar; alt
// kenarda hep ince ilerleme çizgisi. MusicKit'e dokunmaz: durum player-hub'dan (RemotePlayer),
// komutlar hub'a. Windows'ta sürükleme bölgesi fare olaylarını yuttuğu için (üzerine gelme
// çalışmaz) yalnızca üstteki ince şerit sürükler; kapağa çift tık ana pencereye döner.
// Ses (geliştirici kararı 2026-10-18): tuşların sağında hoparlör; çubuk yalnızca imleç hoparlörün
// üzerindeyken (ya da klavye odağındayken) sola doğru açılır, tıklamak sesi kapatır/açar.

/** Kapak isteği (px): pencere en çok 640; yüksek DPI'da keskin kalsın. */
const ART_PX = 1000

const fmt = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useRemotePlayer(port: RemoteHubPort): {
  state: PlayerHubState | null
  time: PlayerTime
  send: (command: PlayerCommand) => void
} {
  const [remote] = useState(() => new RemotePlayer(port))
  const [state, setState] = useState<PlayerHubState | null>(null)
  const [time, setTime] = useState<PlayerTime>({ currentTime: 0, duration: 0 })
  useEffect(() => {
    const offState = remote.on('state', setState)
    const offTime = remote.on('time', setTime)
    remote.start().catch((err: unknown) => console.warn('[mini] hub durumu alınamadı', err))
    return () => {
      offState()
      offTime()
      remote.stop()
    }
  }, [remote])
  const send = (command: PlayerCommand): void => {
    // Ana pencere hazır değilse (PLAYER_NOT_READY) komut düşer; MiniPlayer'da bildirim yok.
    remote.command(command).catch((err: unknown) => console.warn('[mini] komut reddedildi', err))
  }
  return { state, time, send }
}

export function MiniPlayer({ port, onExpand }: { port: RemoteHubPort; onExpand: () => void }) {
  const { state, time, send } = useRemotePlayer(port)
  const now = state?.nowPlaying ?? null
  const playing = state?.playbackState === 'playing'
  const duration = time.duration || now?.durationSec || 0
  const smooth = useSmoothTime(time.currentTime, duration, playing)
  const pending = usePendingSeek(smooth)
  const seekTo = (seconds: number): void => {
    pending.set(seconds)
    send({ type: 'seek', seconds })
  }
  const seekPointer = usePointerRange(now ? duration : 0, seekTo)
  const current = seekPointer.drag ?? pending.value ?? smooth
  const progress = duration > 0 ? Math.min(1, current / duration) : 0
  const art = cachedArtworkUrl(now?.artworkUrl ?? null, ART_PX)
  // Ses: sürüklerken anında duyulsun (hub komutu), bırakınca son değer.
  const setVolume = (v: number): void => send({ type: 'setVolume', volume: v })
  const volumePointer = usePointerRange(state ? 1 : 0, setVolume, setVolume)
  const volume = volumePointer.drag ?? state?.volume ?? 1
  const [lastVolume, setLastVolume] = useState(1)
  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2
  const toggleMute = (): void => {
    if (volume > 0) {
      setLastVolume(volume)
      send({ type: 'setVolume', volume: 0 })
    } else send({ type: 'setVolume', volume: lastVolume || 1 })
  }

  useEffect(() => {
    document.title = now ? `${now.title} — ${now.artist}` : i18n.t('mini.title')
  }, [now])

  // Boşluk: çal / duraklat; ←/→: önceki / sonraki.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.target instanceof HTMLInputElement) return
      const command = miniKeyCommand(e.code)
      if (!command) return
      e.preventDefault()
      send(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="mini" onDoubleClick={onExpand}>
      <AnimatePresence initial={false}>
        {art ? (
          <motion.img
            key={art}
            className="mini__art"
            src={art}
            alt=""
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.45 } }}
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          />
        ) : (
          <motion.div
            key="empty"
            className="mini__empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Music size={48} strokeWidth={1.4} aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mini__grip">
        <button
          type="button"
          className="mini__icon"
          aria-label={i18n.t('mini.expand')}
          title={i18n.t('mini.expand')}
          onClick={onExpand}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Maximize2 size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="mini__controls" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="mini__meta">
          <div className="mini__title">{now?.title ?? i18n.t('mini.nothing')}</div>
          {now ? <div className="mini__artist">{now.artist}</div> : null}
        </div>
        <div className="mini__buttons">
          <span aria-hidden="true" />
          <div className="mini__transport">
            <button
              type="button"
              className="mini__icon"
              aria-label={i18n.t('player.previous')}
              disabled={!now}
              onClick={() => send({ type: 'previous' })}
            >
              <SkipBack size={20} fill="currentColor" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="mini__icon mini__icon--play"
              aria-label={i18n.t(playing ? 'player.pause' : 'player.play')}
              disabled={!now}
              onClick={() => send({ type: 'togglePlay' })}
            >
              {playing ? (
                <Pause size={22} fill="currentColor" aria-hidden="true" />
              ) : (
                <Play size={22} fill="currentColor" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="mini__icon"
              aria-label={i18n.t('player.next')}
              disabled={!now}
              onClick={() => send({ type: 'next' })}
            >
              <SkipForward size={20} fill="currentColor" aria-hidden="true" />
            </button>
          </div>
          <div className="mini__vol">
            <div className="mini__vol-pop">
              <span className="mini__range-box" {...volumePointer.handlers}>
                <input
                  className="mini__range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  aria-label={i18n.t('player.volume')}
                  disabled={!state}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
                <span className="mini__range-track" aria-hidden="true">
                  <span className="mini__range-fill" style={{ transform: `scaleX(${volume})` }} />
                </span>
              </span>
            </div>
            <button
              type="button"
              className="mini__icon"
              aria-label={i18n.t(volume === 0 ? 'player.unmute' : 'player.mute')}
              title={i18n.t(volume === 0 ? 'player.unmute' : 'player.mute')}
              disabled={!state}
              onClick={toggleMute}
            >
              <VolumeIcon size={17} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mini__seek">
          <span>{fmt(current)}</span>
          {/* Dolu kısım `scaleX` (alt piksel kayar); `step="any"`: değer tam saniyeye oturmaz. */}
          <span className="mini__range-box" {...seekPointer.handlers}>
            <span className="mini__range-track" aria-hidden="true">
              <span className="mini__range-fill" style={{ transform: `scaleX(${progress})` }} />
            </span>
            <input
              className="mini__range"
              type="range"
              min={0}
              max={duration || 1}
              step="any"
              value={Math.min(current, duration || 1)}
              aria-label={i18n.t('player.seek')}
              disabled={!now || duration === 0}
              // Yalnızca klavye: fare kapsayıcıda.
              onChange={(e) => seekTo(Number(e.target.value))}
            />
          </span>
          <span>-{fmt(Math.max(0, duration - current))}</span>
        </div>
      </div>

      <div className="mini__line" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}
