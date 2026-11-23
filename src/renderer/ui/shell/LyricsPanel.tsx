import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import {
  lyricsClient,
  lyricsKey,
  shownLine,
  type LinePin,
  type Lyrics
} from '@core/background/lyrics'
import { toTrackRef } from '@core/background/background'
import { CoreError } from '@core/errors'
import { i18n } from '@core/i18n'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { useActiveLine } from '../hooks/useActiveLine'
import { useSettings } from '../context'

// Sözler paneli (B11b). Geliştirici kararı (2026-10-14): Apple Music gibi büyük kalın satırlar; çalan
// satır parlak, diğerleri soluk, geçmiş satırlar hafif bulanık; çalan satır panelin üst üçte birinde
// durur. Satıra basınca o ana sarılır. Kaynak notu ("Sözler: LRCLIB") sözlerin en altında.
// Kullanıcı tekerlekle / kaydırma çubuğuyla gezinirse otomatik takip FOLLOW_PAUSE_MS süre durur.
// Sözler LRCLIB'den gelir (worker); metin dış veridir, yalnızca metin olarak basılır.

const FOLLOW_PAUSE_MS = 3_000
/** Tıklanan satır en fazla bu süre, konum ona ulaşmasa da vurgulu kalır (sarma başarısızsa). */
const PIN_MS = 2_000
/** Çalan satırın panel yüksekliğine göre durduğu yer (üst üçte bir). */
const ANCHOR = 0.3
/** Satırdan satıra kayma süresi (geliştirici 2026-10-15: tarayıcının "smooth" kaydırması sert ve hızlıydı). */
const FOLLOW_MS = 650

/** Yavaş başlayıp yavaş biten kayma; dönen işlev yarıda keser. */
function animateScroll(el: Element, to: number, ms = FOLLOW_MS): () => void {
  const from = el.scrollTop
  const dist = to - from
  if (Math.abs(dist) < 1) return () => {}
  const start = performance.now()
  let frame = 0
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / ms)
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    el.scrollTop = from + dist * eased
    if (t < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}

type State =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; lyrics: Lyrics }
  | { status: 'error'; key: string }

const client = lyricsClient

/** `stage`: büyük oynatıcıdaki dev sözler (aynı mantık, büyük yazı). */
export type LyricsKindState = 'loading' | 'error' | 'none' | 'instrumental' | 'plain' | 'synced'

export function LyricsPanel({
  variant = 'panel',
  onKind
}: {
  variant?: 'panel' | 'stage'
  /** Büyük oynatıcı: söz yoksa kapak ortaya geçer. */
  onKind?: (kind: LyricsKindState) => void
} = {}) {
  const { player, snapshot, currentTime, duration } = usePlayer()
  const track = displayedTrack(snapshot)
  const ref = useMemo(
    () => toTrackRef(track),
    // Kimlik değil içerik: aynı şarkının yeni snapshot'ı yeniden istek atmasın.
    [track?.title, track?.artist, track?.album, track?.durationSec, track?.catalogId, track?.isrc]
  )
  const key = lyricsKey(ref)
  const [state, setState] = useState<State>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!ref || !key) {
      setState({ status: 'idle' })
      return
    }
    let live = true
    setState({ status: 'loading', key })
    client()
      .get(ref)
      .then(
        (lyrics) => live && setState({ status: 'ready', key, lyrics }),
        (err: unknown) => {
          // İptal: şarkı değişti, yeni istek zaten yolda.
          if (err instanceof CoreError && err.code === 'BG_CANCELLED') return
          if (live) setState({ status: 'error', key })
        }
      )
    return () => {
      live = false
    }
  }, [ref, key, attempt])

  // Çalan ve sıradaki şarkının sözleri uygulama genelinde önden yüklenir (connectLyricsPrefetch).

  const current = state.status !== 'idle' && state.key === key ? state : null
  const kind: LyricsKindState =
    !current || current.status === 'loading'
      ? 'loading'
      : current.status === 'error'
        ? 'error'
        : current.lyrics.kind
  useEffect(() => onKind?.(kind), [kind, onKind])
  if (!track) return <p className="right-panel__empty">{i18n.t('player.nothingPlaying')}</p>
  if (!current || current.status === 'loading') {
    return <p className="right-panel__empty lyrics__status">{i18n.t('lyrics.loading')}</p>
  }
  if (current.status === 'error') {
    return (
      <div className="lyrics__status">
        <p className="right-panel__empty">{i18n.t('lyrics.failed')}</p>
        <button type="button" className="lyrics__retry" onClick={() => setAttempt((n) => n + 1)}>
          {i18n.t('lyrics.retry')}
        </button>
      </div>
    )
  }
  const { lyrics } = current
  if (lyrics.kind === 'none' || lyrics.kind === 'instrumental') {
    return (
      <p className="right-panel__empty lyrics__status">
        {i18n.t(lyrics.kind === 'none' ? 'lyrics.notFound' : 'lyrics.instrumental')}
      </p>
    )
  }
  return (
    <LyricLines
      key={current.key}
      stage={variant === 'stage'}
      lyrics={lyrics}
      currentTime={currentTime}
      duration={duration}
      playing={snapshot?.state === 'playing'}
      onSeek={(seconds) => void player?.seek(seconds).catch(() => {})}
    />
  )
}

function LyricLines({
  stage,
  lyrics,
  currentTime,
  duration,
  playing,
  onSeek
}: {
  stage: boolean
  lyrics: Lyrics
  currentTime: number
  duration: number
  playing: boolean
  onSeek: (seconds: number) => void
}) {
  const synced = lyrics.kind === 'synced'
  const offsetMs = useSettings()?.tweaks.lyricsOffsetMs ?? 0
  const computed = useActiveLine(
    synced ? lyrics.lines : [],
    currentTime,
    duration,
    playing,
    offsetMs
  )
  const [pin, setPin] = useState<LinePin | null>(null)
  const active = shownLine(computed, pin, performance.now())
  const listRef = useRef<HTMLDivElement>(null)
  const pausedUntil = useRef(0)
  const reduced = useReducedMotion()
  /** Süren kayma (kullanıcı kaydırınca ya da yeni satırda kesilir). */
  const stopScroll = useRef<() => void>(() => {})
  useEffect(() => () => stopScroll.current(), [])

  // Konum tıklanan satıra ulaşınca ya da süre dolunca sabitleme kalkar.
  useEffect(() => {
    if (!pin) return
    if (computed === pin.index) {
      setPin(null)
      return
    }
    const timer = setTimeout(() => setPin(null), Math.max(0, pin.until - performance.now()))
    return () => clearTimeout(timer)
  }, [pin, computed])

  // Kullanıcı kendisi kaydırırsa takip bir süre durur.
  useEffect(() => {
    const scroller = listRef.current?.closest('[data-lyrics-scroller]')
    if (!scroller) return
    const pause = (): void => {
      pausedUntil.current = performance.now() + FOLLOW_PAUSE_MS
      stopScroll.current()
    }
    scroller.addEventListener('wheel', pause, { passive: true })
    scroller.addEventListener('pointerdown', pause)
    return () => {
      scroller.removeEventListener('wheel', pause)
      scroller.removeEventListener('pointerdown', pause)
    }
  }, [])

  const targetTop = (): { scroller: Element; top: number } | null => {
    const list = listRef.current
    const scroller = list?.closest('[data-lyrics-scroller]')
    const line = list?.children[Math.max(0, active)] as HTMLElement | undefined
    if (!scroller || !line) return null
    const top =
      line.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    return { scroller, top: Math.max(0, top - scroller.clientHeight * ANCHOR) }
  }

  // İlk yerleşim (geliştirici 2026-10-15: panel açılınca sözler "aniden aşağı iniyordu"): çizimden önce
  // çalan satıra atlanır, satırlar CSS ile yumuşakça belirir; sonraki satırlar FOLLOW_MS ile kayar.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (placed.current) return
    placed.current = true
    const t = synced ? targetTop() : null
    if (t) t.scroller.scrollTop = t.top
    else listRef.current?.closest('[data-lyrics-scroller]')?.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    if (!synced) return
    const follow = (): void => {
      const t = targetTop()
      if (!t) return
      stopScroll.current()
      if (reduced) t.scroller.scrollTop = t.top
      else stopScroll.current = animateScroll(t.scroller, t.top)
    }
    const wait = pausedUntil.current - performance.now()
    if (wait <= 0) {
      follow()
      return
    }
    const timer = setTimeout(follow, wait)
    return () => clearTimeout(timer)
  }, [active, synced, reduced])

  return (
    <div className={`lyrics${synced ? ' lyrics--synced' : ''}${stage ? ' lyrics--stage' : ''}`}>
      <div ref={listRef} className="lyrics__lines">
        {lyrics.lines.map((line, i) => {
          const text = line.text === '' ? <span className="lyrics__gap">• • •</span> : line.text
          if (!synced || line.timeMs === null) {
            return (
              <p key={i} className="lyrics__line">
                {text}
              </p>
            )
          }
          const cls =
            i === active ? ' lyrics__line--active' : i < active ? ' lyrics__line--past' : ''
          const timeMs = line.timeMs
          return (
            <button
              key={i}
              type="button"
              className={`lyrics__line${cls}`}
              aria-current={i === active ? 'true' : undefined}
              onClick={() => {
                pausedUntil.current = 0
                setPin({ index: i, until: performance.now() + PIN_MS })
                onSeek(timeMs / 1000)
              }}
            >
              {text}
            </button>
          )
        })}
      </div>
      <p className="lyrics__source">{i18n.t('lyrics.source')}</p>
    </div>
  )
}
