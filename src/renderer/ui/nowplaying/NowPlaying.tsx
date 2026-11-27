import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  MessageSquareQuote,
  Palette,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  UserRound,
  Volume,
  Volume2
} from 'lucide-react'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import { useApp, useSettings } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { LyricsPanel } from '../shell/LyricsPanel'
import { Marquee } from '../components/Marquee'
import { SeekBar, VolumeSlider } from '../shell/PlayerDock'
import { QualityBadge } from '../shell/QualityBadge'
import { TitleBar } from '../window/TitleBar'
import { NP_ART_LAYOUT_ID } from './ids'
import { artistImage, prefetchArtistImage, readyArtistImage } from './artistImage'
import { Satellites } from './Satellites'
import { satelliteItems } from './satelliteItems'

// Büyük oynatıcı (B12, geliştirici kararları 2026-10-14; 2026-11-27 tek tasarım). İki mod (geçiş
// düğmesi, bu bilgisayarda hatırlanır; kayıttaki ad `colors` geriye uyum için kaldı):
//  - Kapak: zemin temaya göre saf siyah / beyaz; kapak ve sözler yan yana, sözler düğmeyle açılıp
//    kapanır (hatırlanır), kapalıysa veya söz yoksa kapak ortada. Kapağın iki yanında sıradaki iki şarkı
//    uydu olarak, imleç kapağa gelince belirir (Satellites.tsx).
//  - Sanatçı fotoğrafı (Spotify gibi): sanatçının görseli tüm arka planda; sözler kapalı, oynatıcı
//    altta soldan sağa tam genişlikte (ilerleme + kontroller); kapak oynatıcının sol üstünde, şarkı adı
//    kapağın sağında (geliştirici 2026-10-15).
// Kapak oynatıcı çubuğundaki küçük kapaktan uçarak gelir (`layoutId`). Esc veya ⌄ ile kapanır.

type Mode = 'colors' | 'artist'
const MODE_KEY = 'am-client.nowplaying.mode'
const LYRICS_KEY = 'am-client.nowplaying.lyrics'
const REPEAT_ORDER = ['none', 'all', 'one'] as const

function loadMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'artist' ? 'artist' : 'colors'
  } catch {
    return 'colors'
  }
}
function saveMode(mode: Mode): void {
  try {
    window.localStorage.setItem(MODE_KEY, mode)
  } catch {
    // yalnızca bu oturumda geçerli
  }
}
function loadLyricsOpen(): boolean {
  try {
    return window.localStorage.getItem(LYRICS_KEY) !== 'off'
  } catch {
    return true
  }
}
function saveLyricsOpen(open: boolean): void {
  try {
    window.localStorage.setItem(LYRICS_KEY, open ? 'on' : 'off')
  } catch {
    // yalnızca bu oturumda geçerli
  }
}

/** Sanatçı fotoğrafı (sanatçı modu): hazırsa anında, değilse çözülünce (`artistImage.ts`). */
function useArtistImage(catalogId: string | undefined, artist: string, enabled: boolean) {
  const app = useApp()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const track = { catalogId, artist }
    setUrl(enabled ? (readyArtistImage(track) ?? null) : null)
    if (!enabled || readyArtistImage(track) !== undefined) return
    let live = true
    void artistImage(app.library, track).then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [app, catalogId, artist, enabled])
  return url
}

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const { player, snapshot, currentTime, duration } = usePlayer()
  const track = displayedTrack(snapshot)
  const playing = snapshot?.state === 'playing'
  const repeat = snapshot?.repeat ?? 'none'
  const [mode, setMode] = useState<Mode>(loadMode)
  /** Çalan şarkının sözü var mı (LyricsPanel bildirir). */
  const [hasLyrics, setHasLyrics] = useState(true)
  /** Kullanıcının söz düğmesi (renkler modunda). */
  const [lyricsOpen, setLyricsOpen] = useState(loadLyricsOpen)
  const lyricsShown = mode === 'colors' && lyricsOpen && hasLyrics
  const layout = mode === 'artist' ? 'artist' : lyricsShown ? 'split' : 'center'
  // Dev söz listesinin ilk düzeni kapak uçarken kare atlatıyordu (90 ms): uçuş bitince eklenir.
  const [lyricsReady, setLyricsReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLyricsReady(true), 520)
    return () => clearTimeout(t)
  }, [])
  const artistPhoto = useArtistImage(track?.catalogId, track?.artist ?? '', mode === 'artist')
  // Büyük oynatıcı açıkken çalan ve sıradaki şarkının sanatçı fotoğrafı mod kapalıyken de hazırlanır:
  // sanatçı moduna geçince ve şarkı değişince anında gelir.
  const app = useApp()
  const queue = snapshot?.queue
  const next = queue ? queue.items[Math.max(0, queue.position) + 1] : undefined
  useEffect(() => {
    prefetchArtistImage(app.library, track)
    prefetchArtistImage(app.library, next)
  }, [app, track?.catalogId, track?.artist, next?.catalogId, next?.artist])
  const settings = useSettings()
  const art = cachedArtworkUrl(track?.artworkTemplate, 1200)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleMode = (): void => {
    const next: Mode = mode === 'colors' ? 'artist' : 'colors'
    setMode(next)
    saveMode(next)
  }
  const toggleLyrics = (): void => {
    setLyricsOpen(!lyricsOpen)
    saveLyricsOpen(!lyricsOpen)
  }
  const run = (fn: () => Promise<void> | void) => (): void => {
    void Promise.resolve(fn()).catch(() => {})
  }

  const artEl = art ? (
    <motion.img
      layoutId={NP_ART_LAYOUT_ID}
      className="np__art"
      src={art}
      alt=""
      draggable={false}
      transition={{ layout: { type: 'tween', duration: 0.5, ease: [0.45, 0, 0.15, 1] } }}
    />
  ) : (
    <motion.span layoutId={NP_ART_LAYOUT_ID} className="np__art np__art--empty" />
  )
  const head = (
    <div className="np__head">
      <Marquee className="np__title" text={track?.title ?? i18n.t('player.nothingPlaying')} />
      <div className="np__artist-name">
        {track ? `${track.artist}${track.album ? ` — ${track.album}` : ''}` : ''}
      </div>
    </div>
  )

  return (
    <motion.div
      className={`np np--${mode}`}
      role="dialog"
      aria-label={i18n.t('np.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.35 } }}
      exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.05 } }}
    >
      <div className="np__bg">
        <AnimatePresence initial={false}>
          {mode === 'artist' && artistPhoto ? (
            <motion.img
              key={artistPhoto}
              className="np__artist"
              src={artistPhoto}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 0.5 } }}
            />
          ) : null}
        </AnimatePresence>
        {mode === 'artist' ? (
          <>
            <div className="np__scrim np__scrim--artist" />
            <div className="np__dock-blur" />
          </>
        ) : null}
      </div>

      <TitleBar />
      <div className="np__top">
        <button
          type="button"
          className="np__icon"
          aria-label={i18n.t('np.close')}
          title={i18n.t('np.close')}
          onClick={onClose}
        >
          <ChevronDown size={22} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="np__icon"
          aria-label={i18n.t(mode === 'colors' ? 'np.modeArtist' : 'np.modeColors')}
          title={i18n.t(mode === 'colors' ? 'np.modeArtist' : 'np.modeColors')}
          onClick={toggleMode}
        >
          {mode === 'colors' ? (
            <UserRound size={19} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Palette size={19} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
        {mode === 'colors' ? (
          <button
            type="button"
            className={`np__icon${lyricsShown ? ' np__icon--on' : ''}`}
            aria-label={i18n.t('player.lyrics')}
            aria-pressed={lyricsShown}
            title={i18n.t('player.lyrics')}
            disabled={!hasLyrics}
            onClick={toggleLyrics}
          >
            <MessageSquareQuote size={19} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className={`np__body np__body--${layout}`}>
        <motion.div
          className="np__left"
          layout
          transition={{ layout: { type: 'tween', duration: 0.5, ease: [0.45, 0, 0.15, 1] } }}
        >
          {mode === 'artist' ? (
            <div className="np__lead">
              {artEl}
              {head}
            </div>
          ) : (
            <Satellites
              items={satelliteItems(queue?.items ?? [], queue?.position ?? 0)}
              onPlay={(index) => void player?.playQueueIndex(index).catch(() => {})}
            >
              {artEl}
            </Satellites>
          )}
          {track ? (
            <div className="np__quality">
              <QualityBadge quality={settings?.playback.streamingQuality ?? 'high'} />
            </div>
          ) : null}
          <motion.div
            className="np__meta"
            layout="position"
            transition={{ layout: { type: 'tween', duration: 0.5, ease: [0.45, 0, 0.15, 1] } }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.25, duration: 0.4 } }}
          >
            {mode === 'artist' ? null : head}
            <SeekBar
              player={player}
              currentTime={currentTime}
              duration={duration}
              playing={playing}
            />
            <div className="np__controls">
              <button
                type="button"
                className={`np__icon${snapshot?.shuffle ? ' np__icon--on' : ''}`}
                aria-label={i18n.t('player.shuffle')}
                onClick={() => player?.setShuffle(!snapshot?.shuffle)}
              >
                <Shuffle size={20} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="np__icon np__icon--big"
                aria-label={i18n.t('player.previous')}
                onClick={run(() => player?.previous())}
              >
                <SkipBack size={34} fill="currentColor" strokeWidth={1.2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="np__icon np__icon--play"
                aria-label={i18n.t(playing ? 'player.pause' : 'player.play')}
                onClick={run(() => (playing ? player?.pause() : player?.play()))}
              >
                {playing ? (
                  <Pause size={46} fill="currentColor" strokeWidth={1} aria-hidden="true" />
                ) : (
                  <Play size={46} fill="currentColor" strokeWidth={1} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="np__icon np__icon--big"
                aria-label={i18n.t('player.next')}
                onClick={run(() => player?.next())}
              >
                <SkipForward size={34} fill="currentColor" strokeWidth={1.2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`np__icon${repeat !== 'none' ? ' np__icon--on' : ''}`}
                aria-label={i18n.t(
                  repeat === 'one'
                    ? 'player.repeatOne'
                    : repeat === 'all'
                      ? 'player.repeatAll'
                      : 'player.repeatOff'
                )}
                onClick={() =>
                  player?.setRepeat(
                    REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length]!
                  )
                }
              >
                {repeat === 'one' ? (
                  <Repeat1 size={20} strokeWidth={1.9} aria-hidden="true" />
                ) : (
                  <Repeat size={20} strokeWidth={1.9} aria-hidden="true" />
                )}
              </button>
            </div>
            {/* Ses (geliştirici kararı 2026-10-18): kontrollerin altında, iki yanda hoparlör. */}
            <div className="np__volume">
              <Volume size={16} strokeWidth={2} aria-hidden="true" />
              <VolumeSlider player={player} volume={snapshot?.volume ?? 1} />
              <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
            </div>
          </motion.div>
        </motion.div>
        {/* Hep takılı (gizlenir): söz durumu her şarkıda yeniden bildirilir. */}
        <motion.div
          className={`np__lyrics${lyricsShown ? '' : ' np__lyrics--hidden'}`}
          data-lyrics-scroller=""
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { delay: 0.2, duration: 0.45 } }}
        >
          {lyricsReady && (
            <LyricsPanel
              variant="stage"
              onKind={(k) => {
                if (k !== 'loading') setHasLyrics(k === 'synced' || k === 'plain')
              }}
            />
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}
