import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode
} from 'react'
import {
  Disc3,
  Heart,
  Link,
  ListEnd,
  ListMusic,
  ListPlus,
  ListStart,
  MicVocal,
  Pencil,
  Play,
  Plus,
  ThumbsDown,
  Trash2
} from 'lucide-react'
import type { Card, Playlist, Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import type { NowPlaying } from '@core/musickit/player'
import { useApp, useSettings } from '../context'
import { usePlaylists } from '../hooks/usePlaylists'
import { playAction } from '../components/playAction'
import { useGo } from '../shell/scroll'
import { useOverlays, type MenuEntry } from './Overlays'

// Şarkı / kart / liste menüleri (geliştirici kararı: "…" + sağ tık, içerik Apple Music gibi).
// Apple'ın resmi API'sinin izin vermediği liste işlemleri (düzenle, sil, listeden çıkar) görünür
// ama pasif: docs/LIBRARY_WRITE.md "Desteklenmeyenler".

/** Şarkının kimlikleri: çalınacak id, katalog id (bağlantı, sayfalar), arşiv id. */
export function trackIds(t: Track): {
  play: string
  catalog: string | null
  library: string | null
} {
  const library = t.id.startsWith('i.') ? t.id : null
  const catalog = t.playParams?.catalogId ?? (library ? null : (t.playParams?.id ?? t.id))
  return { play: t.playParams?.catalogId ?? t.playParams?.id ?? t.id, catalog, library }
}

/** Şarkının kuyrukta tanınabileceği tüm kimlikler (karıştırmada başlangıç şarkısı, `Player`). */
export function trackTargets(t: Track): string[] {
  return [t.id, t.playParams?.id, t.playParams?.catalogId].filter(
    (id): id is string => typeof id === 'string' && id !== ''
  )
}

/** Şarkı kartı (listeler, arama) → menü için şarkı. */
export function cardTrack(c: Card): Track {
  return {
    id: c.id,
    name: c.name,
    artistName: c.subtitle,
    albumName: '',
    durationMs: null,
    playParams: c.playParams,
    artworkUrl: c.artworkUrl,
    ...(c.explicit ? { explicit: true } : {})
  }
}

/** Kuyruk öğesi (Sıradaki) → menü için şarkı. Kütüphane öğesinde katalog id `catalogId`'dedir. */
export function nowPlayingTrack(item: NowPlaying): Track {
  return {
    id: item.id,
    name: item.title,
    artistName: item.artist,
    albumName: item.album,
    durationMs: item.durationSec > 0 ? Math.round(item.durationSec * 1000) : null,
    playParams: {
      id: item.id,
      kind: 'song',
      ...(item.catalogId && item.catalogId !== item.id ? { catalogId: item.catalogId } : {})
    },
    artworkUrl: null
  }
}

const isLibraryPlaylist = (id: string): boolean => id.startsWith('p.')

/** Menüyü sağ tıkta imleçte, "…" düğmesinde düğmenin altında açar. */
export function useMenuTrigger(build: () => MenuEntry[]) {
  const { openMenu } = useOverlays()
  return {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      openMenu(build(), { x: e.clientX, y: e.clientY })
    },
    onMore: (e: MouseEvent<HTMLElement>) => {
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      openMenu(build(), { x: r.left, y: r.bottom + 4 })
    }
  }
}

/** Yazma sonucu kuyruğa mı alındı (`WriteResult.queued`)? */
export function isQueued(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { queued?: unknown }).queued === true
  )
}

/** Ortak işlem sarmalayıcı: başarıda kısa bildirim, hatada "İşlem yapılamadı". */
function useRun() {
  const { toast } = useOverlays()
  return useCallback(
    (work: () => Promise<unknown> | undefined, done: string) => () => {
      const p = work()
      if (!p) return
      p.then(
        // §3.4: çevrimdışıyken Apple'a yazma kuyruğa alınır; bağlantı gelince gönderilir.
        (result) => toast(isQueued(result) ? i18n.t('menu.toast.queued') : done),
        () => toast(i18n.t('menu.toast.failed'), { tone: 'error' })
      )
    },
    [toast]
  )
}

function useAddToPlaylistEntry() {
  const app = useApp()
  const settings = useSettings()
  const playlists = usePlaylists()
  const { newPlaylist } = useOverlays()
  const run = useRun()
  return (tracks: Track[]): MenuEntry => {
    const editable = playlists.filter((p) => p.canEdit)
    return {
      kind: 'submenu',
      label: i18n.t('menu.addToPlaylist'),
      icon: ListPlus,
      items: [
        {
          kind: 'item',
          label: i18n.t('menu.newPlaylist'),
          icon: Plus,
          onSelect: () => newPlaylist(tracks)
        },
        ...(editable.length > 0 ? [{ kind: 'separator' } as const] : []),
        ...editable.map((p: Playlist): MenuEntry => ({
          kind: 'item',
          label: p.name,
          icon: ListMusic,
          onSelect: run(
            () =>
              app.library.addTracksToPlaylist(
                p.id,
                tracks,
                settings?.advanced.addSongsToLibraryOnPlaylistAdd
              ),
            i18n.t('menu.toast.addedToPlaylist', { name: p.name })
          )
        }))
      ]
    }
  }
}

/** Şarkı menüsü üreticisi (MenuProvider bir kez kurar). */
function useBuildTrackMenu(): TrackMenu {
  const app = useApp()
  const go = useGo()
  const run = useRun()
  const addToPlaylist = useAddToPlaylistEntry()
  return (t, playlist) => {
    const player = app.hasPlayer ? app.player : null
    const ids = trackIds(t)
    const rating = ids.catalog
      ? { kind: 'songs' as const, id: ids.catalog }
      : ids.library
        ? { kind: 'library-songs' as const, id: ids.library }
        : null
    const goTo = (which: 'album' | 'artist') => () => {
      if (!ids.catalog) return
      app.library.getSongLinks(ids.catalog).then(
        (l) => {
          if (which === 'album' && l.albumId) {
            go({ name: 'album', id: l.albumId, title: l.albumName, artworkUrl: l.albumArtworkUrl })
          } else if (which === 'artist' && l.artistId) {
            go({ name: 'artist', id: l.artistId, title: l.artistName })
          }
        },
        () => {}
      )
    }
    const entries: MenuEntry[] = [
      {
        kind: 'item',
        label: i18n.t('menu.playNext'),
        icon: ListStart,
        disabled: !player,
        onSelect: run(
          () => player?.enqueue({ kind: 'song', id: ids.play }, 'next'),
          i18n.t('menu.toast.playNext')
        )
      },
      {
        kind: 'item',
        label: i18n.t('menu.playLater'),
        icon: ListEnd,
        disabled: !player,
        onSelect: run(
          () => player?.enqueue({ kind: 'song', id: ids.play }, 'later'),
          i18n.t('menu.toast.playLater')
        )
      },
      { kind: 'separator' }
    ]
    if (ids.catalog && !ids.library) {
      const catalog = ids.catalog
      entries.push({
        kind: 'item',
        label: i18n.t('menu.addToLibrary'),
        icon: Plus,
        onSelect: run(
          () => app.library.addToLibrary({ songs: [catalog] }),
          i18n.t('menu.toast.addedToLibrary')
        )
      })
    }
    entries.push(addToPlaylist([t]), { kind: 'separator' })
    if (rating) {
      entries.push(
        {
          kind: 'item',
          label: i18n.t('menu.favorite'),
          icon: Heart,
          onSelect: run(
            () => app.library.setRating(rating.kind, rating.id, 1),
            i18n.t('menu.toast.favorited')
          )
        },
        {
          kind: 'item',
          label: i18n.t('menu.suggestLess'),
          icon: ThumbsDown,
          onSelect: run(
            () => app.library.setRating(rating.kind, rating.id, -1),
            i18n.t('menu.toast.suggestLess')
          )
        },
        { kind: 'separator' }
      )
    }
    entries.push(
      {
        kind: 'item',
        label: i18n.t('menu.goToAlbum'),
        icon: Disc3,
        disabled: !ids.catalog,
        onSelect: goTo('album')
      },
      {
        kind: 'item',
        label: i18n.t('menu.goToArtist'),
        icon: MicVocal,
        disabled: !ids.catalog,
        onSelect: goTo('artist')
      },
      {
        kind: 'item',
        label: i18n.t('menu.copyLink'),
        icon: Link,
        disabled: !ids.catalog,
        onSelect: run(
          () => (ids.catalog ? app.copyLink('song', ids.catalog) : undefined),
          i18n.t('menu.toast.linkCopied')
        )
      }
    )
    if (playlist && isLibraryPlaylist(playlist.id)) {
      entries.push(
        { kind: 'separator' },
        {
          kind: 'item',
          label: i18n.t('menu.removeFromPlaylist'),
          icon: Trash2,
          danger: true,
          disabled: true,
          hint: i18n.t('menu.notAllowed'),
          onSelect: () => {}
        }
      )
    }
    return entries
  }
}

/** Kart menüsü üreticisi (MenuProvider bir kez kurar). */
function useBuildCardMenu(trackMenu: TrackMenu): CardMenu {
  const app = useApp()
  const run = useRun()
  return (c) => {
    const player = app.hasPlayer ? app.player : null
    if (c.kind === 'song') return trackMenu(cardTrack(c))
    const entries: MenuEntry[] = []
    const play = playAction(player, c)
    if (play) entries.push({ kind: 'item', label: i18n.t('menu.play'), icon: Play, onSelect: play })
    if (c.kind === 'album' || c.kind === 'playlist') {
      const item = { kind: c.kind, id: c.id }
      entries.push(
        {
          kind: 'item',
          label: i18n.t('menu.playNext'),
          icon: ListStart,
          disabled: !player,
          onSelect: run(() => player?.enqueue(item, 'next'), i18n.t('menu.toast.playNext'))
        },
        {
          kind: 'item',
          label: i18n.t('menu.playLater'),
          icon: ListEnd,
          disabled: !player,
          onSelect: run(() => player?.enqueue(item, 'later'), i18n.t('menu.toast.playLater'))
        }
      )
    }
    const catalog = !/^(l|p|r|i)\./.test(c.id)
    if (catalog && (c.kind === 'album' || c.kind === 'playlist')) {
      const ids = c.kind === 'album' ? { albums: [c.id] } : { playlists: [c.id] }
      entries.push(
        { kind: 'separator' },
        {
          kind: 'item',
          label: i18n.t('menu.addToLibrary'),
          icon: Plus,
          onSelect: run(() => app.library.addToLibrary(ids), i18n.t('menu.toast.addedToLibrary'))
        }
      )
    }
    if (catalog) {
      entries.push(
        { kind: 'separator' },
        {
          kind: 'item',
          label: i18n.t('menu.copyLink'),
          icon: Link,
          onSelect: run(() => app.copyLink(c.kind, c.id), i18n.t('menu.toast.linkCopied'))
        }
      )
    }
    if (c.kind === 'playlist' && isLibraryPlaylist(c.id)) entries.push(...playlistEditEntries())
    return entries
  }
}

/** Kullanıcı listesinin düzenle / sil öğeleri: Apple resmi API'de yok → pasif (geliştirici kararı). */
function playlistEditEntries(): MenuEntry[] {
  const hint = i18n.t('menu.notAllowed')
  return [
    { kind: 'separator' },
    {
      kind: 'item',
      label: i18n.t('menu.editPlaylist'),
      icon: Pencil,
      disabled: true,
      hint,
      onSelect: () => {}
    },
    {
      kind: 'item',
      label: i18n.t('menu.deletePlaylist'),
      icon: Trash2,
      danger: true,
      disabled: true,
      hint,
      onSelect: () => {}
    }
  ]
}

/** Yan menüdeki kullanıcı listesi → kart menüsüyle aynı. */
export function playlistCard(p: Playlist): Card {
  return {
    kind: 'playlist',
    id: p.id,
    name: p.name,
    subtitle: '',
    artworkUrl: p.artworkUrl,
    playParams: null
  }
}

type TrackMenu = (t: Track, playlist?: { id: string }) => MenuEntry[]
type CardMenu = (c: Card) => MenuEntry[]

const MenuContext = createContext<{ track: TrackMenu; card: CardMenu } | null>(null)

/**
 * Menü üreticileri kabukta bir kez kurulur (listeler bir kez okunur); kartlara sabit fonksiyonlar
 * gider: yüzlerce kart her biri ayrı abonelik açmaz, menü değişince yeniden çizilmez.
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const track = useBuildTrackMenu()
  const card = useBuildCardMenu(track)
  const latest = useRef({ track, card })
  useEffect(() => {
    latest.current = { track, card }
  })
  const value = useMemo(() => {
    const trackFn: TrackMenu = (t, p) => latest.current.track(t, p)
    const cardFn: CardMenu = (c) => latest.current.card(c)
    return { track: trackFn, card: cardFn }
  }, [])
  return createElement(MenuContext.Provider, { value }, children)
}

function useMenus() {
  const value = useContext(MenuContext)
  if (!value) throw new Error('MenuProvider eksik')
  return value
}

/** Şarkı menüsü. `playlist`: şarkı bu kullanıcı listesinin içinden açıldıysa ("Listeden Çıkar"). */
export const useTrackMenu = (): TrackMenu => useMenus().track

/** Kart menüsü: albüm, liste, istasyon, sanatçı (şarkı kartı → şarkı menüsü). */
export const useCardMenu = (): CardMenu => useMenus().card
