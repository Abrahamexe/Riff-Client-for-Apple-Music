import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  Check,
  ChevronsLeft,
  Info,
  ListMusic,
  MessageSquareQuote,
  PictureInPicture2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Star,
  Volume,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { RightPanel } from '@shared/settings'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import type { Player } from '@core/musickit/player'
import { displayedTrack, formatTime, usePlayer } from '../hooks/usePlayer'
import { useSmoothTime } from '../hooks/smoothTime'
import { usePendingSeek } from '../hooks/pendingSeek'
import { usePointerRange } from '../hooks/pointerRange'
import { useTrackActions } from '../hooks/useTrackActions'
import { useApp, useSettings } from '../context'
import { stepVolume } from '../theme/tweaks'
import { Glass } from '../glass/Glass'
import type { Rect } from './layout'
import { dropletTransition, shownWhen } from './motion'
import { NP_ART_LAYOUT_ID } from '../nowplaying/ids'
import { prefetchArtistImage } from '../nowplaying/artistImage'
import { openSongArtist } from './artistLink'
import { useOverlays } from '../overlays/Overlays'
import { useGo } from './scroll'
import { QualityBadge } from './QualityBadge'

// Alt oynatıcı (B3): referans cam çubuk (Desktop/tasarım örneği.png) + Apple Music'teki düğmeler.
// Kullanıcı basınca sol alttaki baloncuğa küçülür (ilerleme halkalı); baloncuğa basınca soldan
// sağa açılır. AirPlay MusicKit JS'te olmadığı için yok.

const RING = 2 * Math.PI * 27
const REPEAT_ORDER = ['none', 'all', 'one'] as const

function Bubble({
  art,
  progress,
  visible,
  onExpand
}: {
  art: string | null
  progress: number
  visible: boolean
  onExpand: () => void
}) {
  return (
    <motion.button
      type="button"
      className="bubble"
      aria-label={i18n.t('player.expand')}
      title={i18n.t('player.expand')}
      onClick={onExpand}
      inert={!visible}
      initial={false}
      animate={shownWhen(visible)}
    >
      {art ? <img src={art} alt="" draggable={false} /> : <span className="bubble__art" />}
      <svg className="bubble__ring" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="27" className="bubble__ring-track" />
        <circle
          cx="30"
          cy="30"
          r="27"
          className="bubble__ring-fill"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - progress)}
        />
      </svg>
    </motion.button>
  )
}

function IconButton({
  label,
  onClick,
  onPointerEnter,
  disabled,
  on,
  large,
  children
}: {
  label: string
  onClick: () => void
  onPointerEnter?: () => void
  disabled?: boolean
  on?: boolean
  large?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`icon-button${large ? ' icon-button--large' : ''}${on ? ' icon-button--on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
    >
      {children}
    </button>
  )
}

const fill = (ratio: number): CSSProperties =>
  ({ '--p': `${Math.min(1, Math.max(0, ratio)) * 100}%` }) as CSSProperties

/**
 * Büyük oynatıcının kapağı (1200 px) fare küçük kapağın üzerine gelince önceden indirilip çözülür:
 * açılışta çözümleme uçuş sırasında 104 ms'lik kare atlatıyordu (duman testi).
 */
function preloadLargeArt(template: string | null | undefined): void {
  const src = cachedArtworkUrl(template, 1200)
  if (!src) return
  const img = new Image()
  img.src = src
  void img.decode().catch(() => {})
}

export function PlayerDock({
  rect,
  expanded,
  rightPanel,
  onExpandedChange,
  onRightPanel,
  nowPlayingOpen,
  onOpenNowPlaying
}: {
  rect: Rect
  expanded: boolean
  rightPanel: RightPanel
  onExpandedChange: (expanded: boolean) => void
  onRightPanel: (panel: RightPanel) => void
  /** Büyük oynatıcı açıkken küçük kapak gizlenir (kapak oraya uçmuş durumda). */
  nowPlayingOpen: boolean
  onOpenNowPlaying: () => void
}) {
  const { player, snapshot, currentTime, duration } = usePlayer()
  const now = displayedTrack(snapshot)
  const actions = useTrackActions(now)
  const app = useApp()
  const settings = useSettings()
  const go = useGo()
  const { toast } = useOverlays()
  const openArtist = (): void => {
    if (!now) return
    const lookup = {
      getSongLinks: (id: string) => app.library.getSongLinks(id),
      searchArtists: (name: string) => app.library.searchArtists(name)
    }
    void openSongArtist(now, lookup, go).then((ok) => {
      if (!ok) toast(i18n.t('player.artistNotFound'))
    })
  }
  const [lastVolume, setLastVolume] = useState(1)
  const playing = snapshot?.state === 'playing'
  // Baloncuğun halkası: bildirilen konum yeter (küçük; saniyede bir güncellenir).
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0
  const volume = snapshot?.volume ?? 1
  const repeat = snapshot?.repeat ?? 'none'
  const art = cachedArtworkUrl(now?.artworkTemplate, 96)
  const run = (fn: () => Promise<void> | void) => (): void => {
    void Promise.resolve(fn()).catch(() => {})
  }
  const VolumeIcon =
    volume === 0 ? VolumeX : volume < 0.34 ? Volume : volume < 0.67 ? Volume1 : Volume2
  const togglePanel = (panel: Exclude<RightPanel, 'none'>) => (): void =>
    onRightPanel(rightPanel === panel ? 'none' : panel)

  return (
    <motion.div
      className={`glass player${expanded ? '' : ' player--bubble'}`}
      initial={false}
      animate={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius: expanded ? 22 : rect.height / 2
      }}
      transition={dropletTransition(expanded)}
    >
      {/* Çubuk ve baloncuk hep takılı (B5 akıcılık): geçişte yalnızca görünürlük değişir. */}
      <motion.div
        className="player__content"
        inert={!expanded}
        initial={false}
        animate={shownWhen(expanded)}
      >
        <SeekBar player={player} currentTime={currentTime} duration={duration} playing={playing} />
        <div className="player__row">
          <div className="player__controls">
            <IconButton label={i18n.t('player.collapse')} onClick={() => onExpandedChange(false)}>
              <ChevronsLeft size={18} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t('player.shuffle')}
              on={snapshot?.shuffle ?? false}
              disabled={!player}
              onClick={() => player?.setShuffle(!snapshot?.shuffle)}
            >
              <Shuffle size={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t('player.previous')}
              disabled={!player}
              onClick={run(() => player?.previous())}
            >
              <SkipBack size={19} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
            <IconButton
              large
              label={i18n.t(playing ? 'player.pause' : 'player.play')}
              disabled={!player}
              onClick={run(() => (playing ? player?.pause() : player?.play()))}
            >
              {playing ? (
                <Pause size={24} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Play size={24} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label={i18n.t('player.next')}
              disabled={!player}
              onClick={run(() => player?.next())}
            >
              <SkipForward size={19} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t(
                repeat === 'one'
                  ? 'player.repeatOne'
                  : repeat === 'all'
                    ? 'player.repeatAll'
                    : 'player.repeatOff'
              )}
              on={repeat !== 'none'}
              disabled={!player}
              onClick={() =>
                player?.setRepeat(
                  REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length]!
                )
              }
            >
              {repeat === 'one' ? (
                <Repeat1 size={17} strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <Repeat size={17} strokeWidth={1.9} aria-hidden="true" />
              )}
            </IconButton>
            <span className="player__divider" aria-hidden="true" />
            <IconButton
              label={i18n.t(actions.inLibrary ? 'player.inLibrary' : 'player.addToLibrary')}
              on={actions.inLibrary}
              disabled={!now || actions.inLibrary || !now.catalogId}
              onClick={actions.addToLibrary}
            >
              {actions.inLibrary ? (
                <Check size={18} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Plus size={18} strokeWidth={2} aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label={i18n.t(actions.favorite ? 'player.unfavorite' : 'player.favorite')}
              on={actions.favorite}
              disabled={!now}
              onClick={actions.toggleFavorite}
            >
              <Star
                size={18}
                strokeWidth={1.9}
                fill={actions.favorite ? 'currentColor' : 'none'}
                aria-hidden="true"
              />
            </IconButton>
          </div>
          <Glass variant="capsule" className="player__now">
            <button
              type="button"
              className="player__art-button"
              aria-label={i18n.t('player.openNowPlaying')}
              title={i18n.t('player.openNowPlaying')}
              disabled={!now}
              onClick={onOpenNowPlaying}
              onPointerEnter={() => {
                preloadLargeArt(now?.artworkTemplate)
                prefetchArtistImage(app.library, now)
              }}
            >
              {nowPlayingOpen ? (
                <span className="player__art player__art--away" />
              ) : art ? (
                <motion.img
                  layoutId={NP_ART_LAYOUT_ID}
                  className="player__art"
                  src={art}
                  alt=""
                  draggable={false}
                  transition={{
                    layout: { type: 'tween', duration: 0.45, ease: [0.45, 0, 0.15, 1] }
                  }}
                />
              ) : (
                <span className="player__art" />
              )}
            </button>
            <div className="player__now-text">
              <div className="player__now-title">
                {now?.title ?? i18n.t('player.nothingPlaying')}
              </div>
              <div className="player__now-sub">
                {now?.artist ? (
                  <button type="button" className="player__now-link" onClick={openArtist}>
                    {now.artist}
                  </button>
                ) : null}
                {now?.album ? ` — ${now.album}` : ''}
              </div>
            </div>
            {now ? (
              <QualityBadge
                className="quality-badge--dock"
                quality={settings?.playback.streamingQuality ?? 'high'}
              />
            ) : null}
          </Glass>
          <div className="player__right">
            <IconButton
              label={i18n.t('player.openMini')}
              disabled={!now}
              onClick={() => openMiniPlayer(settings?.advanced.keepMiniPlayerOnTop ?? false)}
            >
              <PictureInPicture2 size={18} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t('player.info')}
              on={rightPanel === 'info'}
              onClick={togglePanel('info')}
            >
              <Info size={18} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t('player.lyrics')}
              on={rightPanel === 'lyrics'}
              onClick={togglePanel('lyrics')}
            >
              <MessageSquareQuote size={18} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t('player.queue')}
              on={rightPanel === 'queue'}
              onClick={togglePanel('queue')}
            >
              <ListMusic size={18} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={i18n.t(volume === 0 ? 'player.unmute' : 'player.mute')}
              disabled={!player}
              onClick={() => {
                if (volume > 0) {
                  setLastVolume(volume)
                  player?.setVolume(0)
                } else player?.setVolume(lastVolume || 1)
              }}
            >
              <VolumeIcon size={18} strokeWidth={1.8} aria-hidden="true" />
            </IconButton>
            <VolumeSlider player={player} volume={volume} />
          </div>
        </div>
      </motion.div>
      <Bubble
        art={art}
        progress={progress}
        visible={!expanded}
        onExpand={() => onExpandedChange(true)}
      />
    </motion.div>
  )
}

/**
 * Ses kaydırıcısı (alt oynatıcı ve büyük oynatıcı). İnce ayar: tekerlekle ses (yukarı = aç), adım
 * Ctrl+↑/↓ ile aynı.
 */
export function VolumeSlider({
  player,
  volume,
  className = ''
}: {
  player: Player | null
  volume: number
  className?: string
}) {
  const settings = useSettings()
  return (
    <input
      className={`slider slider--volume ${className}`.trim()}
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={volume}
      style={fill(volume)}
      aria-label={i18n.t('player.volume')}
      disabled={!player}
      onChange={(e) => player?.setVolume(Number(e.target.value))}
      onWheel={(e) => {
        if (!player || !settings?.tweaks.wheelVolume || e.deltaY === 0) return
        player.setVolume(stepVolume(volume, settings.tweaks.volumeStep, e.deltaY < 0))
      }}
    />
  )
}

/** B12b: MiniPlayer açılır, ana pencere gizlenir (main). Üstte kalma ayardan. */
function openMiniPlayer(alwaysOnTop: boolean): void {
  window.api
    .openMiniPlayer({ alwaysOnTop })
    .catch((err: unknown) => console.warn('[player] MiniPlayer açılamadı', err))
}

/**
 * Zaman satırı (geliştirici: "takılarak gitmesin kayarak devam etsin"): konum kare kare tahmin
 * edilir (`useSmoothTime`); her karede yalnızca bu bileşen yeniden çizilir. Dolu kısım kaydırıcının
 * degradesi değil ayrı bir katmanın `scaleX`'i (2026-10-18): degrade kenarı tam piksele oturduğu için
 * yavaş şarkıda çizgi saniyede birkaç kez "adım" atıyordu; dönüşüm alt piksel kayar. Sürüklerken
 * tahmin durur, bırakınca sarılır. Kaydırıcı ondalıklı (`step="any"`) olduğu için ←/→ elle sarar.
 */
export function SeekBar({
  player,
  currentTime,
  duration,
  playing
}: {
  player: Player | null
  currentTime: number
  duration: number
  playing: boolean
}) {
  const smooth = useSmoothTime(currentTime, duration, playing)
  // Klavye ←/→ sarma adımı (sn): İnce ayar.
  const seekStep = useSettings()?.tweaks.seekStep ?? 5
  const disabled = !player || duration <= 0
  const pending = usePendingSeek(smooth)
  const seek = (to: number): void => {
    const target = Math.max(0, Math.min(duration, to))
    pending.set(target)
    void player?.seek(target).catch(() => pending.set(null))
  }
  // Fare kapsayıcıda (pointerRange.ts): kaydırıcının `change` olayı eski konumu taşıyordu.
  const pointer = usePointerRange(disabled ? 0 : duration, seek)
  const time = pointer.drag ?? pending.value ?? smooth
  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    seek(time + (e.key === 'ArrowRight' ? seekStep : -seekStep))
  }
  return (
    <div className="player__time">
      <span>{formatTime(time)}</span>
      <div className={`seek${disabled ? ' seek--disabled' : ''}`} {...pointer.handlers}>
        <span className="seek__track" aria-hidden="true">
          <span className="seek__fill" style={{ transform: `scaleX(${progress})` }} />
        </span>
        <input
          className="slider slider--seek"
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step="any"
          value={time}
          aria-label={i18n.t('player.seek')}
          aria-valuetext={formatTime(time)}
          disabled={disabled}
          // Yalnızca klavye (Home/End vb.): fare kapsayıcıda.
          onChange={(e) => seek(Number(e.target.value))}
          onKeyDown={onKeyDown}
        />
      </div>
      <span>-{formatTime(Math.max(0, duration - time))}</span>
    </div>
  )
}
