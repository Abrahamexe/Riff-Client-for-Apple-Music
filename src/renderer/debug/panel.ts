// Debug paneli (yalnızca dev build; PLAN_v5 P6): ürün arayüzü değil, altyapı testi için düz HTML +
// log alanı. Çekirdek servisler `app/bootstrap.ts`'teki `App`'te; burası yalnızca düğmeleri ona bağlar
// ve olaylarını loglar. Prod derlemesinde ne bu modül ne işaretlemesi pakete girer
// (verify-prod-bundle.mjs).

import type { Playlist, Track } from '@core/data/library'
import { SearchController } from '@core/data/search'
import { getMusicKit } from '@core/musickit/loader'
import type { Player } from '@core/musickit/player'
import type { BackgroundProgress, BackgroundResult } from '@core/background/background'
import { TrackRefSchema, type BackgroundStage } from '@shared/background'
import { frameThrottle } from '@core/frame'
import { fromWireError, toCoreError, userMessageWithId, type CoreError } from '@core/errors'
import { i18n } from '@core/i18n'
import type { App } from '../app/bootstrap'
import type { SettingsClient } from '@core/settings/settings'
import { unwrap } from '../ipc'
import { checkWidevine, WIDEVINE_KEY_SYSTEM } from './widevine'

type Level = 'ok' | 'fail' | 'info'

const CATALOG_SEARCH_URL = 'https://api.music.apple.com/v1/catalog/tr/search'
const fmtTime = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * `root`: index.html'deki statik panel işaretlemesi (yalnızca dev build); burada yalnızca olaylar
 * bağlanır. `app.start()`'tan ÖNCE çağrılır ki açılış olayları da loglansın.
 */
export function mountDebugPanel(root: HTMLElement, app: App): void {
  // B1: arayüz ana pencerede; panel üstte gizli katman, Ctrl+Shift+D ile açılır/kapanır (yalnızca dev).
  root.classList.add('debug-overlay')
  root.hidden = true
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') root.hidden = !root.hidden
  })

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!
  const on = (sel: string, fn: () => void | Promise<void>): void =>
    $(sel).addEventListener('click', () => void fn())

  const logEl = $<HTMLPreElement>('#log')
  const log = (level: Level, message: string): void => {
    const tag = level === 'ok' ? '[OK]  ' : level === 'fail' ? '[FAIL]' : '[..]  '
    logEl.textContent += `${new Date().toLocaleTimeString()} ${tag} ${message}\n`
  }
  // Kullanıcı mesajı (etkin dilde, katalog kimliğiyle) + teknik ayrıntı (yalnızca debug panelinde).
  const describe = (e: CoreError): string => {
    const cause = e.cause instanceof Error ? ` — ${e.cause.message}` : ''
    return `${userMessageWithId(e, i18n)} [${e.code}: ${e.message}${cause}]`
  }
  const fail = (err: unknown, fallback = 'İşlem başarısız'): void => {
    log('fail', describe(toCoreError(err, 'UNKNOWN', fallback)))
  }

  // CSP ihlalleri: hangi Apple host'unun eklenmesi gerektiğini gösterir (PLAN 1.4).
  document.addEventListener('securitypolicyviolation', (e) => {
    let host = e.blockedURI
    try {
      host = new URL(e.blockedURI).origin
    } catch {
      /* inline/eval/data vb. */
    }
    log('fail', `CSP engelledi: ${e.violatedDirective} ← ${host}`)
  })

  // --- Widevine -----------------------------------------------------------------------------
  const runWidevine = async (): Promise<void> => {
    log('info', `requestMediaKeySystemAccess('${WIDEVINE_KEY_SYSTEM}') deneniyor…`)
    const r = await checkWidevine()
    if (r.available) {
      log(
        'ok',
        `Widevine CDM kurulu ve erişilebilir (keySystem=${r.keySystem}, robustness=${r.robustness}, MediaKeys=${r.mediaKeysCreated})`
      )
    } else {
      log('fail', `Widevine erişilemiyor: ${r.error}`)
    }
  }

  // --- CDM durumu (1.2R) ----------------------------------------------------------------------
  // Pencere CDM'i beklemeden açılır; çalma, CDM hazır olana kadar Player içinde bekletilir.
  const cdmEl = $<HTMLDivElement>('#cdm-status')
  const CDM_TEXT = {
    pending: 'hazırlanıyor (indiriliyor olabilir)…',
    ready: 'hazır',
    error: 'HATA'
  }
  app.on('cdm', (status) => {
    cdmEl.textContent = `CDM: ${CDM_TEXT[status.state]}`
    if (status.state === 'ready') {
      log('ok', 'Widevine CDM hazır')
      void runWidevine()
    } else if (status.state === 'error') {
      log('fail', `Widevine CDM kurulamadı: ${status.message}`)
    }
  })

  // --- Developer token ----------------------------------------------------------------------
  // Token'ın kendisi asla loglanmaz; sadece uzunluk ve son kullanma zamanı gösterilir.
  const runToken = async (): Promise<void> => {
    log('info', 'Developer token isteniyor (IPC token:getDeveloperToken)…')
    const res = await window.api.getDeveloperToken()
    if (!res.ok) return log('fail', describe(fromWireError(res.error)))
    const { token, expiresAt } = res.value
    const remainingH = ((expiresAt - Date.now() / 1000) / 3600).toFixed(1)
    log(
      'ok',
      `Token alındı (uzunluk=${token.length}, exp=${new Date(expiresAt * 1000).toISOString()}, ~${remainingH} sa kaldı)`
    )
  }

  const runRawSearch = async (): Promise<void> => {
    const res = await window.api.getDeveloperToken()
    if (!res.ok) return log('fail', describe(fromWireError(res.error)))
    log('info', 'GET /v1/catalog/tr/search?term=test&types=songs …')
    try {
      const resp = await fetch(`${CATALOG_SEARCH_URL}?term=test&types=songs`, {
        headers: { Authorization: `Bearer ${res.value.token}` }
      })
      log(resp.status === 200 ? 'ok' : 'fail', `Apple API yanıtı: HTTP ${resp.status}`)
    } catch (err) {
      fail(err, 'İstek başarısız')
    }
  }

  const { library, background, settings, equalizer } = app

  // --- MusicKit ve oturum (olaylar App'ten) ---------------------------------------------------
  app.on('info', (message) => log('info', message))
  app.on('error', ({ error, context }) => log('fail', `${context}: ${describe(error)}`))
  app.on('musicKitReady', ({ storefront }) =>
    log('ok', `MusicKit.getInstance() döndü (storefront=${storefront})`)
  )
  app.on('queueRestored', () => log('ok', 'Son kuyruk geri yüklendi (çalmadan)'))
  app.on('session', (state) => {
    if (state.restored) log('ok', 'Kayıtlı oturum geri yüklendi (giriş ekranı atlandı)')
    else if (state.authorized) log('ok', 'Oturum zaten açık')
    else log('info', 'Kayıtlı oturum yok; "Apple ile giriş yap" ile giriş yapın')
  })
  app.on('unauthorized', () =>
    log(
      'fail',
      'Oturum geçersiz: kayıtlı token silindi. "Apple ile giriş yap" ile yeniden giriş yapın.'
    )
  )
  app.on('reconnected', (done) =>
    log('ok', `Yeniden bağlanma tamam: ${done.join(', ') || 'işlem gerekmedi'}`)
  )

  const runMusicKit = (): Promise<void> => app.startMusicKit()

  const runSignIn = async (): Promise<void> => {
    log('info', 'Apple giriş penceresi açılıyor…')
    try {
      await app.signIn()
      log('ok', 'Giriş başarılı; token şifreli (safeStorage) kaydedildi')
    } catch (err) {
      fail(err, 'Giriş başarısız')
    }
  }

  const runSignOut = async (): Promise<void> => {
    try {
      await app.signOut()
      log('ok', 'Çıkış yapıldı; kayıtlı token silindi')
    } catch (err) {
      fail(err, 'Çıkış hatası')
    }
  }

  const runLibraryProbe = async (): Promise<void> => {
    try {
      log('ok', `Kütüphaneye erişildi (ilk sayfada ${await library.probeLibraryAccess()} playlist)`)
    } catch (err) {
      fail(err, 'Kütüphane erişimi başarısız')
    }
  }

  // --- Kütüphane / arama listesi (1.7a) -----------------------------------------------------
  // Veri worker'daki yerel DB'den anında gelir (SWR); arka plan senkronizasyonu bir şey değiştirirse
  // `onChanged` ile açık görünüm yeniden okunur. Ağ yoksa yerel veri gösterilmeye devam eder.
  const listEl = $<HTMLUListElement>('#list')
  const infoEl = $<HTMLDivElement>('#list-info')
  const moreEl = $<HTMLButtonElement>('#btn-more')
  type View = { kind: 'playlists' } | { kind: 'tracks'; playlist: Playlist; loaded: number } | null
  let view: View = null
  const TRACK_PAGE = 100

  const syncedText = (syncedAt: number | null): string =>
    syncedAt === null
      ? 'henüz senkronize edilmedi (arka planda yükleniyor…)'
      : `son senkronizasyon ${new Date(syncedAt).toLocaleTimeString()}`
  const addItem = (text: string, onClick: () => void): void => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = text // textContent: API'den gelen metin HTML olarak yorumlanmaz
    btn.addEventListener('click', onClick)
    li.appendChild(btn)
    listEl.appendChild(li)
  }
  const showTracks = (tracks: Track[], onPlay: (t: Track, index: number) => void): void => {
    view = null
    moreEl.hidden = true
    infoEl.textContent = ''
    listEl.replaceChildren()
    tracks.forEach((t, i) => addItem(`${t.name} — ${t.artistName}`, () => onPlay(t, i)))
  }
  const playTrack = async (t: Track): Promise<void> => {
    const id = t.playParams?.catalogId ?? t.playParams?.id ?? t.id
    log('info', `Çalınıyor: ${t.name}`)
    try {
      await usePlayer()?.playSong(id)
    } catch {
      /* hata Player 'error' event'i ile zaten loglandı */
    }
  }
  const renderPlaylists = async (): Promise<void> => {
    const { items, syncedAt } = await library.getPlaylists()
    view = { kind: 'playlists' }
    moreEl.hidden = true
    infoEl.textContent = `${items.length} playlist — ${syncedText(syncedAt)}`
    listEl.replaceChildren()
    for (const p of items) addItem(`📁 ${p.name}`, () => void openPlaylist(p))
  }
  const loadTracks = async (playlist: Playlist, offset: number): Promise<void> => {
    const page = await library.getPlaylistTracks(playlist.id, { offset, limit: TRACK_PAGE })
    if (offset === 0) listEl.replaceChildren()
    page.items.forEach((t, i) =>
      addItem(`${t.name} — ${t.artistName}`, () => {
        void usePlayer()
          ?.playPlaylist(playlist.id, offset + i)
          .catch(() => {})
      })
    )
    const loaded = offset + page.items.length
    view = { kind: 'tracks', playlist, loaded }
    moreEl.hidden = loaded >= page.total
    infoEl.textContent = `"${playlist.name}": ${loaded}/${page.total} şarkı — ${syncedText(page.syncedAt)}`
  }
  const openPlaylist = async (p: Playlist): Promise<void> => {
    try {
      await loadTracks(p, 0)
    } catch (err) {
      fail(err, 'Playlist açılamadı')
    }
  }
  const runPlaylists = async (): Promise<void> => {
    try {
      await renderPlaylists()
      log('ok', "Playlist'ler yerel DB'den okundu")
    } catch (err) {
      fail(err, "Playlist'ler alınamadı")
    }
  }
  const runSync = async (): Promise<void> => {
    try {
      const target =
        view?.kind === 'tracks'
          ? ({ scope: 'playlistTracks', playlistId: view.playlist.id } as const)
          : ({ scope: 'playlists' } as const)
      const { changed } = await library.sync(target)
      log('ok', `Senkronizasyon tamam (${changed ? 'değişiklik var' : 'değişiklik yok'})`)
    } catch (err) {
      fail(err, 'Senkronizasyon başarısız')
    }
  }
  library.onChanged((scope) => {
    log('info', `Yerel veri güncellendi: ${scope.scope}`)
    if (scope.scope === 'playlists' && view?.kind === 'playlists') {
      void renderPlaylists().catch((err) => fail(err))
    }
    if (
      scope.scope === 'playlistTracks' &&
      view?.kind === 'tracks' &&
      view.playlist.id === scope.playlistId
    ) {
      void loadTracks(view.playlist, 0).catch((err) => fail(err))
    }
  })
  library.onSyncError((scope, error) =>
    log('fail', `Arka plan senkronizasyonu (${scope.scope}): ${describe(error)}`)
  )
  moreEl.addEventListener('click', () => {
    if (view?.kind === 'tracks') void loadTracks(view.playlist, view.loaded).catch((e) => fail(e))
  })
  const runRecent = async (): Promise<void> => {
    try {
      const tracks = await library.getRecentlyPlayed()
      log('ok', `Son çalınan ${tracks.length} şarkı`)
      showTracks(tracks, (t) => void playTrack(t))
    } catch (err) {
      fail(err, 'Son çalınanlar alınamadı')
    }
  }
  /** Giriş yapılmamışsa MusicKit'in çözdüğü storefront; giriş varsa worker hesabınkini kullanır. */
  const currentStorefront = (): string | undefined => {
    try {
      const music = getMusicKit()
      return music.isAuthorized ? undefined : music.storefrontId || undefined
    } catch {
      return undefined
    }
  }
  const runSearch = (scope: 'catalog' | 'library') => async (): Promise<void> => {
    try {
      const term = $<HTMLInputElement>('#term').value
      const r =
        scope === 'catalog'
          ? await library.searchCatalog(term, { storefront: currentStorefront() })
          : await library.searchLibrary(term)
      const label = scope === 'catalog' ? 'Katalog' : 'Kütüphane'
      log('ok', `${label} araması: ${r.songs.length} şarkı, ${r.playlists.length} playlist`)
      showTracks(r.songs, (t) => void playTrack(t))
    } catch (err) {
      fail(err, 'Arama başarısız')
    }
  }

  // 3.B1: birleşik arama — yazarken (debounce + yalnızca son istek) ve Enter/düğme ile.
  const search = new SearchController()
  search.onChange((state) => {
    if (state.status === 'error') fail(state.error, `Birleşik arama (“${state.term}”)`)
    if (state.status !== 'done') return
    const { catalog, library: lib, libraryError, term } = state.result
    const count = (g: typeof catalog) =>
      g
        ? `${g.songs.length} şarkı, ${g.albums.length} albüm, ${g.artists.length} sanatçı, ${g.playlists.length} playlist`
        : '—'
    log(
      'ok',
      `Birleşik arama “${term}” ${state.elapsedMs} ms · katalog: ${count(catalog)} · kütüphane: ${
        libraryError ? libraryError.code : count(lib)
      }`
    )
    showTracks([...(lib?.songs ?? []), ...(catalog?.songs ?? [])], (t) => void playTrack(t))
  })
  $<HTMLInputElement>('#term').addEventListener('input', (e) =>
    search.input((e.target as HTMLInputElement).value)
  )
  const runUnifiedSearch = (): Promise<void> => search.submit($<HTMLInputElement>('#term').value)
  const runRecentSearches = async (): Promise<void> => {
    try {
      const recent = await search.recentSearches()
      log('info', `Son aramalar: ${recent.map((r) => r.term).join(' · ') || '(yok)'}`)
    } catch (err) {
      fail(err, 'Son aramalar okunamadı')
    }
  }

  // --- Player -------------------------------------------------------------------------------
  const nowEl = $<HTMLDivElement>('#now-playing')
  const seekEl = $<HTMLInputElement>('#seek')
  let seeking = false

  function ensurePlayer(): Player {
    return app.player
  }

  /** Player hazır değilse (MusicKit yapılandırılmamış) hatayı loglar ve null döner. */
  function usePlayer(): Player | null {
    try {
      return ensurePlayer()
    } catch (err) {
      fail(err, 'Çalma kontrolü kullanılamıyor')
      return null
    }
  }

  app.on('playerReady', (p) => {
    p.on('playbackStateDidChange', ({ state, previous }) =>
      log('info', `Durum: ${previous ?? '—'} → ${state}`)
    )
    p.on('nowPlayingItemDidChange', (item) => {
      nowEl.textContent = item
        ? `Şu an çalan: ${item.title} — ${item.artist} (${item.playbackType})`
        : 'Şu an çalan: —'
      if (!item) return
      const preview = item.playbackType === 'preview'
      log(
        preview ? 'fail' : 'info',
        `Çalan: ${item.title} [${item.playbackType}, ${fmtTime(item.durationSec)}]`
      )
      if (preview) {
        log(
          'fail',
          'Yalnızca 30 sn önizleme çalıyor: geliştirme imzalı ECS reddedilmiş olabilir (bkz. npm run evs:sign-dev).'
        )
      }
    })
    // Kare hızında çizilir; pencere gizliyken çizim durur, görünür olunca son değer çizilir (1.8b).
    p.on(
      'playbackTimeDidChange',
      frameThrottle(({ currentTime, duration }) => {
        if (seeking) return
        seekEl.max = String(Math.max(1, Math.floor(duration)))
        seekEl.value = String(Math.floor(currentTime))
      })
    )
    p.on('queueItemsDidChange', ({ items, position, autoplayIndex }) =>
      log(
        'info',
        `Kuyruk: ${items.length} öğe, sıra ${position}${autoplayIndex === null ? '' : `, otomatik çalma ${autoplayIndex}. sıradan`}`
      )
    )
    p.on('error', (e) => fail(e, 'Çalma hatası'))
  })

  const act = (fn: (p: Player) => Promise<void>) => async (): Promise<void> => {
    try {
      await fn(ensurePlayer())
    } catch {
      /* hata Player 'error' event'i ile zaten loglandı */
    }
  }

  on('#btn-diag', async () => {
    const res = await window.api.exportDiagnostics()
    if (res.ok) log('ok', `Tanılama paketi İndirilenler'e yazıldı: ${res.value.fileName}`)
    else log('fail', describe(fromWireError(res.error)))
  })
  on('#btn-widevine', runWidevine)
  on('#btn-token', runToken)
  on('#btn-search', runRawSearch)
  on('#btn-musickit', runMusicKit)
  on('#btn-signin', runSignIn)
  on('#btn-signout', runSignOut)
  on('#btn-library', runLibraryProbe)
  on('#btn-playlists', runPlaylists)
  on('#btn-sync', runSync)
  on('#btn-recent', runRecent)
  on('#btn-search-catalog', runSearch('catalog'))
  on('#btn-search-library', runSearch('library'))
  on('#btn-search-unified', runUnifiedSearch)
  // Altyapı bitiş kriteri: arayüzün ihtiyaç duyacağı veriler tipli API'lerden (yalnızca sayılar loglanır).
  on('#btn-ui-data', async () => {
    const step = async (name: string, fn: () => Promise<string>) => {
      const t0 = performance.now()
      try {
        log('ok', `${name}: ${await fn()} (${Math.round(performance.now() - t0)} ms)`)
      } catch (err) {
        fail(err, name)
      }
    }
    await step('Ana Sayfa', async () => {
      const g = await library.getRecommendations()
      return `${g.length} grup, ${g.reduce((n, x) => n + x.cards.length, 0)} kart`
    })
    await step('Göz At', async () => {
      const g = await library.getCharts()
      return `${g.length} liste, ${g.reduce((n, x) => n + x.cards.length, 0)} kart`
    })
    await step('Radyo', async () => `${(await library.getLiveStations()).length} istasyon`)
    await step('Son eklenenler', async () => `${(await library.getRecentlyAdded()).length} öğe`)
    for (const [name, get] of [
      ['Şarkılar', () => library.getLibrarySongs({ limit: 5 })],
      ['Albümler', () => library.getLibraryAlbums({ limit: 5 })],
      ['Sanatçılar', () => library.getLibraryArtists({ limit: 5 })]
    ] as const) {
      await step(`Kütüphane ${name}`, async () => {
        const page = await get()
        return `${page.items.length}/${page.total} (senkron ${page.syncedAt ? 'var' : 'arka planda'})`
      })
    }
    const charts = await library.getCharts().catch(() => [])
    const albumCard = charts.flatMap((g) => g.cards).find((c) => c.kind === 'album')
    if (albumCard) {
      await step('Albüm sayfası', async () => {
        const d = await library.getAlbum(albumCard.id)
        return `${d.tracks.length} şarkı, ${d.tracks.filter((t) => t.explicit).length} explicit`
      })
    }
    const searchArtist = await window.api.worker.search({
      term: 'Queen',
      limit: 1,
      scope: 'catalog'
    })
    const artist = searchArtist.ok ? searchArtist.value.catalog?.artists[0] : undefined
    if (artist) {
      await step('Sanatçı sayfası', async () => {
        const d = await library.getArtist(artist.id)
        return `${d.topSongs.length} popüler şarkı, ${d.albums.length} albüm, ${d.singles.length} single, ${d.similarArtists.length} benzer`
      })
    }
    const playlistCard = charts.flatMap((g) => g.cards).find((c) => c.kind === 'playlist')
    if (playlistCard) {
      await step('Playlist sayfası', async () => {
        const d = await library.getCatalogPlaylist(playlistCard.id)
        return `${d.tracks.length} şarkı`
      })
    }
  })
  const updateSetting = async (patch: Parameters<SettingsClient['update']>[0], what: string) => {
    try {
      await settings.update(patch)
      log(
        'ok',
        `${what} · bitrate=${getMusicKit().bitrate} EQ=${equalizer.active ? 'grafik' : 'yok'}`
      )
    } catch (err) {
      fail(err, `${what} değiştirilemedi`)
    }
  }
  on('#btn-settings-show', () => log('info', `Ayarlar: ${JSON.stringify(settings.current)}`))
  on('#btn-quality', () =>
    updateSetting(
      {
        playback: {
          streamingQuality:
            settings.current?.playback.streamingQuality === 'high' ? 'standard' : 'high'
        }
      },
      'Akış kalitesi'
    )
  )
  on('#btn-eq-toggle', () =>
    updateSetting({ equalizer: { enabled: !settings.current?.equalizer.enabled } }, 'EQ')
  )
  on('#btn-eq-demo', () =>
    updateSetting(
      {
        equalizer: {
          enabled: true,
          presetId: null,
          preamp: -3,
          bands: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0]
        }
      },
      'EQ deneme eğrisi'
    )
  )
  on('#btn-cache-reset', async () => {
    try {
      await unwrap(window.api.clearArtworkCache())
      await unwrap(window.api.worker.clearBackgroundCache({}))
      log('ok', 'Önbellek sıfırlandı (kapaklar + müzik arka planı)')
    } catch (err) {
      fail(err, 'Önbellek sıfırlanamadı')
    }
  })
  on('#btn-search-recent', runRecentSearches)
  on(
    '#btn-play-song',
    act((p) => p.playSong($<HTMLInputElement>('#song-id').value))
  )
  on(
    '#btn-prev',
    act((p) => p.previous())
  )
  on(
    '#btn-next',
    act((p) => p.next())
  )
  on(
    '#btn-stop',
    act((p) => p.stop())
  )
  on(
    '#btn-toggle',
    act((p) => (p.snapshot().state === 'playing' ? p.pause() : p.play()))
  )
  // Player'a senkron erişen kontroller: MusicKit hazır değilse hata loglanır, istisna sızmaz.
  const sync = (fn: (p: Player) => void) => (): void => {
    try {
      fn(ensurePlayer())
    } catch (err) {
      fail(err, 'Çalma kontrolü kullanılamıyor')
    }
  }
  on(
    '#btn-shuffle',
    sync((p) => {
      const enable = !p.snapshot().shuffle
      p.setShuffle(enable)
      $('#btn-shuffle').textContent = `Karıştır: ${enable ? 'açık' : 'kapalı'}`
    })
  )
  on(
    '#btn-repeat',
    sync((p) => {
      const order = ['none', 'all', 'one'] as const
      const next = order[(order.indexOf(p.snapshot().repeat) + 1) % order.length]!
      p.setRepeat(next)
      $('#btn-repeat').textContent = `Tekrar: ${{ none: 'yok', all: 'hepsi', one: 'tek' }[next]}`
    })
  )
  $<HTMLInputElement>('#volume').addEventListener('input', (e) =>
    sync((p) => p.setVolume(Number((e.target as HTMLInputElement).value)))()
  )
  seekEl.addEventListener('pointerdown', () => (seeking = true))
  seekEl.addEventListener('change', () => {
    seeking = false
    void act((p) => p.seek(Number(seekEl.value)))()
  })

  // --- Müzik arka planı (3.A7) --------------------------------------------------------------
  // Worker kaynaklardan toplar (hız sınırlı) ve cache'ler; sonuç düz JSON olarak textContent'e yazılır.
  const bgResultEl = $<HTMLPreElement>('#bg-result')
  const bgStagesEl = $<HTMLPreElement>('#bg-stages')
  const STAGE_LABEL: Record<BackgroundStage, string> = {
    match: 'eşleştirme',
    credits: 'MusicBrainz kredileri',
    summary: 'Wikidata/Wikipedia özeti'
  }
  let bgShown: { key: string; ref: unknown } | null = null
  const bgRef = (): unknown => {
    const val = (id: string): string => $<HTMLInputElement>(id).value.trim()
    const duration = Number(val('#bg-duration'))
    return {
      title: val('#bg-title'),
      artist: val('#bg-artist'),
      ...(val('#bg-album') ? { album: val('#bg-album') } : {}),
      ...(val('#bg-isrc') ? { isrc: val('#bg-isrc') } : {}),
      ...(val('#bg-duration') && Number.isFinite(duration)
        ? { durationMs: Math.round(duration) }
        : {})
    }
  }
  const bgSummary = (r: BackgroundResult, ms: number): string => {
    const d = r.data
    const credits = d.credits.length + d.work.composers.length + d.work.lyricists.length
    return (
      `Arka plan (${ms} ms, ${r.cached ? (r.stale ? 'cache — eski, arka planda yenileniyor' : 'cache') : 'kaynaklardan'}): ` +
      `eşleşme=${d.match.status} (${d.match.confidence}), ${credits} kredi, ` +
      `bölümler=${Object.entries(r.sections)
        .map(([k, v]) => `${k}:${v}`)
        .join(',')}${r.complete ? '' : ' (YARIM: cache’e yazılmadı)'}, ` +
      `${d.recording.studios.length} stüdyo, özet=${d.artistSummary ? d.artistSummary.lang : 'yok'}, ` +
      `kaynaklar=${d.sources.map((s) => s.source).join(',') || '—'}`
    )
  }
  const runBackground = async (): Promise<void> => {
    const parsed = TrackRefSchema.safeParse(bgRef())
    if (!parsed.success)
      return log('fail', 'Arka plan: başlık ve sanatçı gerekli (ISRC/süre biçimi geçerli olmalı)')
    log(
      'info',
      'Arka plan isteniyor (worker; ilk istek hız sınırları nedeniyle birkaç saniye sürebilir)…'
    )
    const started = performance.now()
    const stageLines: string[] = []
    bgStagesEl.textContent = ''
    // Her aşama bitince bölüm durumu, süresi ve o ana kadarki ara model gösterilir (3.A8).
    const onProgress = (p: BackgroundProgress): void => {
      const line = `${STAGE_LABEL[p.stage]}: ${p.sections[p.stage]} — aşama ${p.tookMs} ms, istekten beri ${p.atMs} ms`
      stageLines.push(line)
      bgStagesEl.textContent = stageLines.join('\n')
      bgResultEl.textContent = JSON.stringify(p.data, null, 2)
      log('info', `Arka plan · ${line}`)
    }
    try {
      const r = await background.get(parsed.data, i18n.locale, onProgress)
      bgShown = { key: r.key, ref: parsed.data }
      log('ok', bgSummary(r, Math.round(performance.now() - started)))
      bgResultEl.textContent = JSON.stringify(r.data, null, 2) // textContent: dış veri HTML değil
    } catch (err) {
      const error = toCoreError(err, 'UNKNOWN', 'Arka plan alınamadı')
      // İptal hata değildir: başka bir şarkı istendi, eski istek bırakıldı.
      if (error.code === 'BG_CANCELLED')
        log('info', 'Arka plan isteği iptal edildi (şarkı değişti)')
      else fail(err, 'Arka plan alınamadı')
    }
  }
  const runBackgroundPrefetch = async (): Promise<void> => {
    const parsed = TrackRefSchema.safeParse(bgRef())
    if (!parsed.success) return log('fail', 'Arka plan: başlık ve sanatçı gerekli')
    try {
      await background.prefetch(parsed.data, i18n.locale)
      log(
        'ok',
        'Ön yükleme kuyruğa alındı (düşük öncelik); bitince "Arka planı getir" cache’ten döner'
      )
    } catch (err) {
      fail(err, 'Ön yükleme başarısız')
    }
  }
  background.onChanged(({ key, lang }) => {
    log('info', `Arka plan yenilendi ve değişti (${lang})`)
    if (bgShown?.key === key) void runBackground()
  })
  on('#btn-bg-get', runBackground)
  on('#btn-bg-prefetch', runBackgroundPrefetch)

  // --- Dil (1.3b): hata mesajları etkin dilde; debug paneli metni Türkçe kalır ----------------
  const langEl = $<HTMLButtonElement>('#btn-lang')
  const showLang = (): void => {
    langEl.textContent = `Dil: ${i18n.locale} (tercih: ${i18n.localePreference})`
  }
  i18n.onChange((locale) => {
    showLang()
    log('info', `Dil değişti: ${locale} — örnek: ${i18n.t('error.offline')}`)
  })
  langEl.addEventListener('click', () => {
    const order = ['system', 'tr', 'en'] as const
    const next = order[(order.indexOf(i18n.localePreference) + 1) % order.length]!
    i18n.setPreference(next)
    showLang()
  })
  showLang()

  log('info', `origin=${location.origin} secureContext=${window.isSecureContext}`)
}
