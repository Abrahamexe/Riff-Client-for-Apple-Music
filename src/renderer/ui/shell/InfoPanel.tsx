import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import type { SampleRef, TrackBackground } from '@shared/background'
import { SOURCE_LINK, type Artist, type Track } from '@shared/ipc-contract'
import { toTrackRef } from '@core/background/background'
import { cachedArtworkUrl } from '@core/data/artwork'
import { CoreError } from '@core/errors'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { creditGroups, hasAnyInfo, recordingRows } from './infoSections'
import { useGo } from './scroll'

// Bilgi paneli (§3.5). Geliştirici kararları (2026-10-14): sağ sütunda çalan şarkının müzik arka planı;
// geri bildirim "çok karışık" → bölümler ayrı kartlarda, kişiler Apple Music fotoğraflarıyla (yoksa baş
// harfler), sample'lar albüm kapağı + sanatçı fotoğrafıyla; basınca Apple Music sayfası (sanatçı /
// albüm). Fotoğraflar adla, yalnızca güvenli eşleşmeyle aranır (worker `lookupInfoMedia`).
// Dış veri düz metindir (textContent); dış bağlantılar yalnızca izinli kaynaklara (`SOURCE_LINK`).

const SAMPLE_PREVIEW = 6
const MAX_PEOPLE = 40
const MAX_SONGS = 20

type State =
  | { status: 'loading'; key: string; data: TrackBackground | null }
  | { status: 'ready'; key: string; data: TrackBackground }
  | { status: 'error'; key: string }

interface Media {
  artists: Map<string, Artist>
  songs: Map<string, Track>
}

const keyOf = (name: string): string => name.trim().toLocaleLowerCase()

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** Yuvarlak kişi fotoğrafı; yoksa baş harfler. */
function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const src = cachedArtworkUrl(url, size * 2)
  return src ? (
    <img className="info-avatar" src={src} alt="" width={size} height={size} draggable={false} />
  ) : (
    <span className="info-avatar info-avatar--initials" style={{ width: size, height: size }}>
      {initials(name)}
    </span>
  )
}

function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  const app = useApp()
  if (!SOURCE_LINK.test(url)) return <span>{children}</span>
  return (
    <button
      type="button"
      className="info__link"
      onClick={() => void app.openSourceLink(url).catch(() => {})}
    >
      {children}
      <ExternalLink size={11} strokeWidth={2.2} aria-hidden="true" />
    </button>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="info-card">
      <h3 className="info__heading">{title}</h3>
      {children}
    </section>
  )
}

/** Satır: Apple Music karşılığı varsa düğme (basınca sayfa), yoksa düz. */
function Row({ onOpen, children }: { onOpen?: () => void; children: ReactNode }) {
  return onOpen ? (
    <button type="button" className="info-row info-row--link" onClick={onOpen}>
      {children}
    </button>
  ) : (
    <div className="info-row">{children}</div>
  )
}

function Samples({
  title,
  items,
  media,
  openSong
}: {
  title: string
  items: readonly SampleRef[]
  media: Media
  openSong: (t: Track) => void
}) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const shown = all ? items : items.slice(0, SAMPLE_PREVIEW)
  return (
    <div className="info__group">
      <h4 className="info__subheading">{title}</h4>
      {shown.map((s) => {
        const song = media.songs.get(s.mbid)
        const artist = media.artists.get(keyOf(s.artist))
        return (
          <Row key={s.mbid} onOpen={song ? () => openSong(song) : undefined}>
            {song?.artworkUrl ? (
              <img
                className="info-cover"
                src={cachedArtworkUrl(song.artworkUrl, 96) ?? undefined}
                alt=""
                draggable={false}
              />
            ) : (
              <span className="info-cover info-cover--empty" />
            )}
            <span className="info-row__text">
              <span className="info__name">{s.title}</span>
              {s.artist && (
                <span className="info-row__artist">
                  <Avatar name={s.artist} url={artist?.artworkUrl ?? null} size={16} />
                  <span className="info__detail">{s.artist}</span>
                </span>
              )}
            </span>
          </Row>
        )
      })}
      {!all && items.length > SAMPLE_PREVIEW && (
        <button type="button" className="info__more" onClick={() => setAll(true)}>
          {i18n.t('info.showAll', { count: items.length })}
        </button>
      )}
    </div>
  )
}

function Content({ data, media }: { data: TrackBackground; media: Media }) {
  const app = useApp()
  const go = useGo()
  const [expanded, setExpanded] = useState(false)
  const groups = creditGroups(data)
  const rows = recordingRows(data)
  const summary = data.artistSummary
  const mb = data.sources.find((s) => s.source === 'musicbrainz')
  const hasSamples = data.samples.samples.length > 0 || data.samples.sampledBy.length > 0
  const openArtist = (a: Artist | undefined) =>
    a ? () => go({ name: 'artist', id: a.id, title: a.name }) : undefined
  const openSong = (t: Track): void => {
    void app.library.getSongLinks(t.id).then(
      (l) =>
        l.albumId &&
        go({ name: 'album', id: l.albumId, title: l.albumName, artworkUrl: l.albumArtworkUrl }),
      () => {}
    )
  }
  const summaryArtist = summary ? media.artists.get(keyOf(summary.artistName)) : undefined
  return (
    <>
      {data.match.status === 'uncertain' && (
        <p className="info__note">{i18n.t('info.uncertain')}</p>
      )}
      {summary && (
        <Card title={i18n.t('info.about')}>
          <Row onOpen={openArtist(summaryArtist)}>
            <Avatar name={summary.artistName} url={summaryArtist?.artworkUrl ?? null} size={56} />
            <span className="info-row__text">
              <span className="info__artist-name">{summary.artistName}</span>
            </span>
          </Row>
          <p className={`info__summary${expanded ? '' : ' info__summary--clamped'}`}>
            {summary.text}
          </p>
          <button type="button" className="info__more" onClick={() => setExpanded(!expanded)}>
            {i18n.t(expanded ? 'info.less' : 'info.more')}
          </button>
        </Card>
      )}
      {groups.length > 0 && (
        <Card title={i18n.t('info.credits')}>
          {groups.map((g) => (
            <div key={g.key} className="info__group">
              <h4 className="info__subheading">{i18n.t(`info.group.${g.key}`)}</h4>
              {g.people.map((p) => {
                const artist = media.artists.get(keyOf(p.name))
                return (
                  <Row key={p.name + p.roles.join()} onOpen={openArtist(artist)}>
                    <Avatar name={p.name} url={artist?.artworkUrl ?? null} size={36} />
                    <span className="info-row__text">
                      <span className="info__name">{p.name}</span>
                      <span className="info__detail">
                        {[p.roles.map((r) => i18n.format(r)).join(', '), p.detail]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </Row>
                )
              })}
            </div>
          ))}
        </Card>
      )}
      {hasSamples && (
        <Card title={i18n.t('info.samples')}>
          <Samples
            title={i18n.t('info.samplesUsed')}
            items={data.samples.samples}
            media={media}
            openSong={openSong}
          />
          <Samples
            title={i18n.t('info.sampledBy')}
            items={data.samples.sampledBy}
            media={media}
            openSong={openSong}
          />
        </Card>
      )}
      {rows.length > 0 && (
        <Card title={i18n.t('info.recording')}>
          <dl className="info__rows">
            {rows.map((r) => (
              <div key={r.label} className="info__row">
                <dt>{i18n.format(r.label)}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <footer className="info__sources">
        <span>{i18n.t('info.sources')}:</span>
        {mb?.url && <SourceLink url={mb.url}>MusicBrainz</SourceLink>}
        {summary && <SourceLink url={summary.url}>Wikipedia</SourceLink>}
        {summary && <SourceLink url={summary.licenseUrl}>{i18n.t('info.wikiLicense')}</SourceLink>}
      </footer>
    </>
  )
}

/** Panelde fotoğrafı / kapağı aranacak adlar ve sample'lar (yinelenmeden, sınırlı). */
function mediaRequest(data: TrackBackground): {
  artists: string[]
  samples: SampleRef[]
} {
  const names = new Map<string, string>()
  const add = (n: string): void => {
    const k = keyOf(n)
    if (k && !names.has(k) && names.size < MAX_PEOPLE) names.set(k, n.trim())
  }
  if (data.artistSummary) add(data.artistSummary.artistName)
  for (const g of creditGroups(data)) for (const p of g.people) add(p.name)
  const samples = [
    ...data.samples.samples.slice(0, SAMPLE_PREVIEW),
    ...data.samples.sampledBy.slice(0, SAMPLE_PREVIEW)
  ].slice(0, MAX_SONGS)
  for (const s of samples) if (s.artist) add(s.artist)
  return { artists: [...names.values()], samples }
}

export function InfoPanel() {
  const app = useApp()
  const { snapshot } = usePlayer()
  const track = displayedTrack(snapshot)
  const ref = useMemo(
    () => toTrackRef(track),
    // Kimlik değil içerik: aynı şarkının yeni snapshot'ı yeniden istek atmasın.
    [track?.title, track?.artist, track?.album, track?.durationSec, track?.catalogId, track?.isrc]
  )
  const key = ref ? JSON.stringify([ref.title, ref.artist, ref.album ?? '', ref.isrc ?? '']) : null
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [media, setMedia] = useState<Media & { key: string | null }>({
    key: null,
    artists: new Map(),
    songs: new Map()
  })

  useEffect(() => {
    if (!ref || !key) {
      setState(null)
      return
    }
    let live = true
    setState({ status: 'loading', key, data: null })
    app.background
      .get(ref, i18n.locale, (p) => {
        if (live) setState({ status: 'loading', key, data: p.data })
      })
      .then(
        (r) => live && setState({ status: 'ready', key, data: r.data }),
        (err: unknown) => {
          if (err instanceof CoreError && err.code === 'BG_CANCELLED') return
          if (live) setState({ status: 'error', key })
        }
      )
    return () => {
      live = false
    }
  }, [app, ref, key, attempt])

  // Bilgi tamamlanınca fotoğraflar ve kapaklar (Apple Music) bir kez aranır.
  const ready = state?.status === 'ready' && state.key === key ? state.data : null
  useEffect(() => {
    if (!ready || !key) return
    let live = true
    const req = mediaRequest(ready)
    if (req.artists.length === 0 && req.samples.length === 0) return
    app.library
      .lookupInfoMedia(
        req.artists,
        req.samples.map((s) => ({ title: s.title, artist: s.artist }))
      )
      .then(
        (res) => {
          if (!live) return
          const artists = new Map<string, Artist>()
          req.artists.forEach((n, i) => {
            const a = res.artists[i]
            if (a) artists.set(keyOf(n), a)
          })
          const songs = new Map<string, Track>()
          req.samples.forEach((s, i) => {
            const t = res.songs[i]
            if (t) songs.set(s.mbid, t)
          })
          setMedia({ key, artists, songs })
        },
        () => {}
      )
    return () => {
      live = false
    }
  }, [app, ready, key])

  if (!track) return <p className="right-panel__empty">{i18n.t('player.nothingPlaying')}</p>
  const current = state && state.key === key ? state : null
  if (!current || (current.status === 'loading' && !current.data)) {
    return <p className="right-panel__empty">{i18n.t('info.loading')}</p>
  }
  if (current.status === 'error') {
    return (
      <div className="lyrics__status">
        <p className="right-panel__empty">{i18n.t('info.failed')}</p>
        <button type="button" className="lyrics__retry" onClick={() => setAttempt((n) => n + 1)}>
          {i18n.t('lyrics.retry')}
        </button>
      </div>
    )
  }
  const data = current.data
  if (!data) return <p className="right-panel__empty">{i18n.t('info.loading')}</p>
  if (current.status === 'ready' && !hasAnyInfo(data)) {
    return <p className="right-panel__empty">{i18n.t('info.notFound')}</p>
  }
  const shownMedia: Media = media.key === key ? media : { artists: new Map(), songs: new Map() }
  return (
    <div className="info">
      <Content data={data} media={shownMedia} />
      {current.status === 'loading' && <p className="info__note">{i18n.t('info.loading')}</p>}
    </div>
  )
}
