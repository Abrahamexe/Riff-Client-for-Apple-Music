import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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
  UserRound
} from 'lucide-react'
import { cachedArtworkUrl } from '@core/data/artwork'
import { i18n } from '@core/i18n'
import { useApp, useSettings } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { LyricsPanel } from '../shell/LyricsPanel'
import { SeekBar } from '../shell/PlayerDock'
import { QualityBadge } from '../shell/QualityBadge'
import { TitleBar } from '../window/TitleBar'
import { NP_ART_LAYOUT_ID } from './ids'
import { extractPalette, rgbCss, type Rgb } from './palette'

// Büyük oynatıcı (B12, geliştirici kararları 2026-10-14). İki mod (geçiş düğmesi, bu bilgisayarda
// hatırlanır):
//  - "Kapak renkleri": kapak ve sözler yan yana; sözler düğmeyle açılıp kapanır (hatırlanır), kapalıysa
//    veya söz yoksa kapak ortada. Arka plan kapağın 4 baskın renginden bulanık bulutlar, yavaş
//    dalgalanır ve müzikle nabız atar (Equalizer analizcisi; hareketi azalt açıksa durgun).
//  - "Sanatçı fotoğrafı" (Spotify gibi): sanatçının görseli tüm arka planda; sözler kapalı, oynatıcı
//    altta soldan sağa tam genişlikte (ilerleme + kontroller); kapak oynatıcının sol üstünde, şarkı adı
//    kapağın sağında (geliştirici 2026-10-15).
// Kapak oynatıcı çubuğundaki küçük kapaktan uçarak gelir (`layoutId`); kapağa kendi renginde ışık.
// Esc veya ⌄ ile kapanır.

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

/** Kapağın küçük (48 px) önbellekli kopyasından palet; yüklenemezse koyu nötr. */
function usePalette(template: string | null | undefined): Rgb[] | null {
  const [palette, setPalette] = useState<Rgb[] | null>(null)
  const src = cachedArtworkUrl(template, 48)
  useEffect(() => {
    if (!src) return
    let live = true
    const img = new Image()
    img.onload = () => {
      if (!live) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 32, 32)
        setPalette(extractPalette(ctx.getImageData(0, 0, 32, 32).data))
      } catch {
        setPalette(null)
      }
    }
    img.src = src
    return () => {
      live = false
    }
  }, [src])
  return palette
}

// Şarkı (katalog id / sanatçı adı) → sanatçı görseli. Üç ardışık istek yavaş DNS'te ~4 sn sürüyor;
// mod tekrar açıldığında veya şarkı tekrar çaldığında anında gelsin.
const artistImageCache = new Map<string, string | null>()
const ARTIST_IMAGE_CACHE_MAX = 200

/** Sanatçı fotoğrafı: şarkının sanatçısı (Apple katalog) → büyük görsel. */
function useArtistImage(catalogId: string | undefined, artist: string, enabled: boolean) {
  const app = useApp()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const key = catalogId ?? `name:${artist}`
    setUrl(enabled ? (artistImageCache.get(key) ?? null) : null)
    if (!enabled || artistImageCache.has(key)) return
    let live = true
    const fromLinks = catalogId
      ? app.library
          .getSongLinks(catalogId)
          .then((l) => (l.artistId ? app.library.getArtist(l.artistId) : null))
      : Promise.resolve(null)
    void fromLinks
      .then(async (detail) => {
        if (detail?.artist.artworkUrl) return detail.artist.artworkUrl
        const r = await app.library.lookupInfoMedia([artist], [])
        return r.artists[0]?.artworkUrl ?? null
      })
      .then((u) => {
        const resolved = cachedArtworkUrl(u, 1600)
        if (artistImageCache.size >= ARTIST_IMAGE_CACHE_MAX) artistImageCache.clear()
        artistImageCache.set(key, resolved)
        if (live) setUrl(resolved)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [app, catalogId, artist, enabled])
  return url
}

/**
 * "Müzikle nabız": çalarken her karede ses düzeyi okunur, yumuşatılıp arka plana `--pulse` (0..1)
 * olarak yazılır (React çizimi yok; yalnızca CSS değişkeni). Hareketi azaltta kapalı.
 */
function usePulse(
  target: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  /** İnce ayar: nabız şiddeti (1 = varsayılan). */
  strength = 1
) {
  const app = useApp()
  useEffect(() => {
    const el = target.current
    if (!el || !active) {
      el?.style.setProperty('--pulse', '0')
      return
    }
    app.equalizer.startAnalysis([...document.querySelectorAll('audio')])
    let frame = 0
    let smooth = 0
    const tick = (): void => {
      const level = Math.min(1, app.equalizer.level() * strength)
      // Yükselişte hızlı, inişte yavaş (nabız hissi).
      smooth += (level - smooth) * (level > smooth ? 0.35 : 0.06)
      el.style.setProperty('--pulse', smooth.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [app, target, active, strength])
}

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const { player, snapshot, currentTime, duration } = usePlayer()
  const reduced = useReducedMotion() ?? false
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
  // Bulutların ilk çizimi (dev bulanıklık) ve dev söz listesinin ilk düzeni kapak uçarken kare
  // atlatıyordu (104 / 90 ms): ikisi de uçuş bitince eklenir.
  const [cloudsReady, setCloudsReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setCloudsReady(true), 520)
    return () => clearTimeout(t)
  }, [])
  const bg = useRef<HTMLDivElement>(null)
  const palette = usePalette(track?.artworkTemplate)
  const artistImage = useArtistImage(track?.catalogId, track?.artist ?? '', mode === 'artist')
  const settings = useSettings()
  const pulseStrength = (settings?.tweaks.pulseStrength ?? 100) / 100
  usePulse(bg, playing && !reduced && mode === 'colors' && pulseStrength > 0, pulseStrength)
  const art = cachedArtworkUrl(track?.artworkTemplate, 1200)
  const colors = useMemo(
    () =>
      palette ??
      ([
        [40, 40, 52],
        [28, 28, 36],
        [60, 56, 72],
        [20, 20, 26]
      ] as Rgb[]),
    [palette]
  )

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
      style={{
        boxShadow: `0 30px 90px ${rgbCss(colors[0]!, 0.55)}, 0 8px 30px rgb(0 0 0 / 0.45)`
      }}
    />
  ) : (
    <motion.span layoutId={NP_ART_LAYOUT_ID} className="np__art np__art--empty" />
  )
  const head = (
    <div className="np__head">
      <div className="np__title">{track?.title ?? i18n.t('player.nothingPlaying')}</div>
      <div className="np__artist-name">
        {track ? `${track.artist}${track.album ? ` — ${track.album}` : ''}` : ''}
      </div>
    </div>
  )

  return (
    <motion.div
      className={`np np--${mode}${reduced ? ' np--still' : ''}`}
      role="dialog"
      aria-label={i18n.t('np.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.35 } }}
      exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.05 } }}
    >
      <div className="np__bg" ref={bg}>
        <AnimatePresence initial={false}>
          {mode === 'artist' && artistImage ? (
            <motion.img
              key={artistImage}
              className="np__artist"
              src={artistImage}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 0.5 } }}
            />
          ) : cloudsReady ? (
            <motion.div
              key="clouds"
              className="np__clouds"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 0.5 } }}
            >
              {colors.map((c, i) => (
                <span
                  key={i}
                  className={`np__cloud np__cloud--${i}`}
                  style={{ backgroundColor: rgbCss(c) }}
                />
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className={`np__scrim${mode === 'artist' ? ' np__scrim--artist' : ''}`} />
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
            artEl
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
          </motion.div>
        </motion.div>
        {/* Hep takılı (gizlenir): söz durumu her şarkıda yeniden bildirilir. */}
        <motion.div
          className={`np__lyrics${lyricsShown ? '' : ' np__lyrics--hidden'}`}
          data-lyrics-scroller=""
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0, transition: { delay: 0.2, duration: 0.45 } }}
        >
          {cloudsReady && (
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
