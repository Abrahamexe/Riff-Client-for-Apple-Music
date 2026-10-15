import { TypedEmitter } from '../emitter'
import { CoreError, logError, toCoreError } from '../errors'
import { guarded } from './guard'
import { getMusicKit } from './loader'
import {
  PlaybackState,
  PlaybackType,
  RepeatMode,
  ShuffleMode,
  type MediaItem,
  type MusicKitEventName,
  type MusicKitInstance,
  type QueueOptions
} from './types'

// Çalma kontrolleri, kuyruk ve tipli event'ler (PLAN 1.6 + 1.8). UI'ın dinleyeceği tek kaynak `Player`dır.
// Event'lerin yükünü MusicKit'in event nesnelerinden değil, örneğin güncel durumundan okuruz:
// v3 event şekilleri belgelenmemiş, örnek özellikleri ise kararlı.

export type PlaybackStateName = keyof typeof PlaybackState
export type RepeatModeName = keyof typeof RepeatMode
export type PlaybackTypeName = keyof typeof PlaybackType

export interface NowPlaying {
  id: string
  title: string
  artist: string
  album: string
  /** `{w}x{h}` şablonlu ham URL; `resolveArtwork` ile boyutlandırılır. */
  artworkTemplate: string | null
  durationSec: number
  /** `encryptedFull` = tam şarkı, `preview` = 30 sn önizleme (DRM/imza sorunu belirtisi). */
  playbackType: PlaybackTypeName | 'unknown'
  /** Varsa ISRC (müzik arka planı eşleştirmesi için, PLAN 3.A). */
  isrc?: string
  /**
   * Apple katalog şarkı id'si (V8): kütüphane öğesinde `playParams.catalogId`, katalog öğesinde id.
   * Kütüphane öğelerinde ISRC olmadığı için worker ISRC'yi bununla çözer.
   */
  catalogId?: string
}

/** Kuyruk (Sıradaki). */
export interface QueueSnapshot {
  items: NowPlaying[]
  position: number
  /**
   * Apple'ın otomatik çalma bölümünün başladığı sıra (PLAN_v5 P3; Apple Music'teki "Otomatik çalma"
   * başlığı); bölüm yoksa `null`. Bu sıradan sonuna kadar öğeler otomatik çalmadır.
   */
  autoplayIndex: number | null
}

export interface PlayerEvents {
  playbackStateDidChange: { state: PlaybackStateName; previous: PlaybackStateName | null }
  nowPlayingItemDidChange: NowPlaying | null
  playbackTimeDidChange: { currentTime: number; duration: number }
  queueItemsDidChange: QueueSnapshot
  /** Ses düzeyi, karıştırma veya tekrar değişti (player-hub yayını için, PLAN 1.8a). */
  settingsDidChange: { volume: number; shuffle: boolean; repeat: RepeatModeName }
  error: CoreError
}

export interface PlayerSnapshot {
  state: PlaybackStateName
  nowPlaying: NowPlaying | null
  currentTime: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: RepeatModeName
  queue: QueueSnapshot
}

/** Kuyruğa eklenebilen öğe (B: şarkı menüsü). */
export interface EnqueueItem {
  kind: 'song' | 'album' | 'playlist'
  id: string
}

export interface PlayerOptions {
  /**
   * Çalma başlamadan önce beklenir (PLAN 1.2R: Widevine CDM hazır olana kadar çalma bekletilir).
   * Reject ederse çalma başlamaz; hata `error` event'i olarak da yayınlanır.
   */
  beforePlayback?: () => Promise<void>
}

export const resolveArtwork = (template: string | null, size = 512): string | null =>
  template ? template.replace('{w}', String(size)).replace('{h}', String(size)) : null

function nameOf<T extends Record<string, number>>(table: T, value: number): keyof T | null {
  const entry = Object.entries(table).find(([, v]) => v === value)
  return entry ? entry[0] : null
}

export function toNowPlaying(item: MediaItem | undefined | null): NowPlaying | null {
  if (!item) return null
  const a = item.attributes
  return {
    id: item.id,
    title: item.title ?? a?.name ?? '',
    artist: item.artistName ?? a?.artistName ?? '',
    album: item.albumName ?? a?.albumName ?? '',
    artworkTemplate: item.artwork?.url ?? a?.artwork?.url ?? null,
    durationSec: (item.playbackDuration ?? 0) / 1000,
    playbackType:
      item.playbackType === undefined
        ? 'unknown'
        : (nameOf(PlaybackType, item.playbackType) ?? 'unknown'),
    ...(typeof a?.isrc === 'string' && a.isrc !== '' ? { isrc: a.isrc } : {}),
    ...catalogIdOf(item)
  }
}

const NUMERIC_ID = /^[0-9]{1,20}$/

function catalogIdOf(item: MediaItem): { catalogId?: string } {
  const fromParams = item.playParams?.catalogId ?? item.attributes?.playParams?.catalogId
  if (typeof fromParams === 'string' && NUMERIC_ID.test(fromParams))
    return { catalogId: fromParams }
  return NUMERIC_ID.test(item.id) ? { catalogId: item.id } : {}
}

const EVENTS = [
  'playbackStateDidChange',
  'nowPlayingItemDidChange',
  'playbackTimeDidChange',
  'queueItemsDidChange',
  'queuePositionDidChange',
  'mediaPlaybackError'
] as const satisfies readonly MusicKitEventName[]

type HandledEvent = (typeof EVENTS)[number]

export class Player extends TypedEmitter<PlayerEvents> {
  private previousState: PlaybackStateName | null = null
  private readonly handlers = new Map<HandledEvent, (event: unknown) => void>()

  private readonly beforePlayback: () => Promise<void>

  constructor(
    private readonly music: MusicKitInstance = getMusicKit(),
    options: PlayerOptions = {}
  ) {
    super()
    this.beforePlayback = options.beforePlayback ?? (async () => {})
    this.previousState = this.stateName()
    for (const name of EVENTS) {
      const handler = (event: unknown): void => this.onMusicKitEvent(name, event)
      this.handlers.set(name, handler)
      music.addEventListener(name, handler)
    }
  }

  dispose(): void {
    for (const [name, handler] of this.handlers) this.music.removeEventListener(name, handler)
    this.handlers.clear()
    this.removeAllListeners()
  }

  // --- Durum ------------------------------------------------------------------------------

  snapshot(): PlayerSnapshot {
    const m = this.music
    return {
      state: this.stateName(),
      nowPlaying: toNowPlaying(m.nowPlayingItem),
      // V9 bulgusu: geri yüklenen konum ilk çalışa kadar bekler; o sırada MusicKit 0 der. Bekleyen
      // konum bildirilir — aksi halde kayıt (ve kapanıştaki flush) konumu 0'a çeker, arayüz 0 gösterir.
      currentTime:
        m.currentPlaybackTime > 0 ? m.currentPlaybackTime : (this.resumeAt?.seconds ?? 0),
      duration: m.currentPlaybackDuration || 0,
      volume: m.volume,
      shuffle: m.shuffleMode === ShuffleMode.songs,
      repeat: nameOf(RepeatMode, m.repeatMode) ?? 'none',
      queue: this.queueSnapshot()
    }
  }

  // --- Kuyruk ve çalma başlatma -------------------------------------------------------------

  // Kuyruğu değiştiren işlemler sırayla çalışır (V6 bulgusu: açılıştaki geri yükleme ~14 sn sürerken
  // kullanıcı bir şarkı seçince iki setQueue iç içe geçti ve çalma başlamadı). Kullanıcının isteği
  // önceliklidir: henüz başlamamış bir geri yükleme, arkasından yeni istek geldiyse atlanır.
  private queueChain: Promise<void> = Promise.resolve()
  private queueGeneration = 0
  /** Karıştırmalı geri yüklemede ilk çalışın başlayacağı sıra (`shuffledStartIndex`). */
  private pendingStart: number | null = null
  /** Geri yüklenen kuyrukta ilk çalışta atlanacak konum (sn); kullanıcı başka yere giderse silinir. */
  private resumeAt: { index: number; seconds: number } | null = null

  private enqueueQueueOp(fn: (superseded: () => boolean) => Promise<void>): Promise<void> {
    const generation = ++this.queueGeneration
    const superseded = (): boolean => generation !== this.queueGeneration
    const op = this.queueChain.then(() => fn(superseded))
    this.queueChain = op.catch(() => {})
    return op
  }

  /**
   * Sonraki kuyruk işlemleri bu iş bitene kadar bekler (R2: açılışta mağaza eşitlemesi; arayüz
   * beklemez ama hiçbir `setQueue` yanlış mağazaya gitmez). İşin hatası yutulur.
   */
  holdQueueUntil(task: Promise<unknown>): void {
    this.queueChain = this.queueChain
      .then(() => task)
      .then(
        () => {},
        () => {}
      )
  }

  /** Tek bir katalog şarkısını çalar (Adım 1.6 DRM testi). */
  playSong(songId: string): Promise<void> {
    return this.startQueue({ song: this.requireId(songId, 'Şarkı id') })
  }

  /** Playlist'i kuyruğa alıp çalar; `startIndex` verilirse o şarkıdan başlar. */
  playPlaylist(playlistId: string, startIndex?: number): Promise<void> {
    return this.startQueue({
      playlist: this.requireId(playlistId, 'Playlist id'),
      ...(startIndex !== undefined ? { startWith: this.requireIndex(startIndex) } : {})
    })
  }

  /** Albümü kuyruğa alıp çalar; `startIndex` verilirse o şarkıdan başlar. */
  playAlbum(albumId: string, startIndex?: number): Promise<void> {
    return this.startQueue({
      album: this.requireId(albumId, 'Albüm id'),
      ...(startIndex !== undefined ? { startWith: this.requireIndex(startIndex) } : {})
    })
  }

  /** Şarkı listesini kuyruğa alıp çalar (sanatçı sayfası "Popüler Parçalar"); `startIndex`'ten. */
  playSongs(songIds: readonly string[], startIndex = 0): Promise<void> {
    const songs = songIds.map((id) => this.requireId(id, 'Şarkı id'))
    if (songs.length === 0) throw new CoreError('INVALID_ARGUMENT', 'Şarkı listesi boş.')
    const start = Math.min(this.requireIndex(startIndex), songs.length - 1)
    return this.startQueue({ songs, startWith: start }, songs[start])
  }

  /**
   * Şarkı / albüm / listeyi çalan öğeden hemen sonraya (`next`) ya da kuyruğun sonuna (`later`)
   * ekler (Apple "Sıradaki Çal" / "Sonra Çal"). Kuyruk yoksa MusicKit yeni kuyruk kurar.
   */
  enqueue(item: EnqueueItem, where: 'next' | 'later'): Promise<void> {
    const id = this.requireId(item.id, 'Öğe id')
    const options: QueueOptions = { [item.kind]: id }
    return this.run('Kuyruğa eklenemedi.', async () => {
      await (where === 'next' ? this.music.playNext(options) : this.music.playLater(options))
    })
  }

  /** Radyo istasyonunu çalar (Ana Sayfa "Sadece Sana Özel", Radyo). */
  playStation(stationId: string): Promise<void> {
    return this.startQueue({ station: this.requireId(stationId, 'İstasyon id') })
  }

  /**
   * Kayıtlı kuyruğu (worker'daki player_state) ÇALMADAN geri yükler. Kaydedilen konum (saniye),
   * geri yüklenen şarkı ilk kez çalınınca uygulanır (MusicKit medya yüklenmeden seek kabul etmez).
   * V6: MusicKit kütüphane id'leriyle (`i.…`) kurulan kuyruğu kabul ediyor (gerçek hesapla doğrulandı).
   */
  restoreQueue(state: {
    queue: readonly string[]
    position: number
    currentTime?: number
  }): Promise<void> {
    const songs = state.queue.filter((id) => typeof id === 'string' && id.trim() !== '')
    if (songs.length === 0) return Promise.resolve()
    const startWith = Math.min(Math.max(0, Math.trunc(state.position)), songs.length - 1)
    const seconds = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime ?? 0) : 0
    return this.enqueueQueueOp(async (superseded) => {
      if (superseded()) return // kullanıcı bu arada başka bir şey çaldı
      // setQueue'dan ÖNCE: kurulum sırasında gelen kuyruk olayları (kalıcı kayıt) konumu görsün.
      this.resumeAt = seconds > 0 ? { index: startWith, seconds } : null
      try {
        await this.run('Kuyruk geri yüklenemedi.', async () => {
          await guarded(
            () => this.music.setQueue({ songs, startWith, startPlaying: false }),
            'Kuyruk geri yüklenemedi.'
          )
          // Karıştırma açıksa kayıtlı şarkı başka sıraya düşer: ilk çalış oradan başlar.
          const fixed = this.shuffledStartIndex(startWith, songs[startWith])
          if (fixed !== null) {
            this.pendingStart = fixed
            if (this.resumeAt) this.resumeAt = { ...this.resumeAt, index: fixed }
          }
        })
      } catch (err) {
        if (!superseded()) this.resumeAt = null
        throw err
      }
    })
  }

  /** Mevcut kuyrukta belirli bir sıradaki şarkıya geçer. */
  playQueueIndex(index: number): Promise<void> {
    this.resumeAt = null
    this.pendingStart = null
    return this.enqueueQueueOp(() =>
      this.run('Kuyrukta şarkı değiştirilemedi.', async () => {
        const target = this.requireIndex(index)
        await this.beforePlayback()
        await this.music.changeToMediaAtIndex(target)
      })
    )
  }

  // --- Sıradaki düzenleme (§3.2) ------------------------------------------------------------
  // Sıralar `snapshot().queue` sırasıdır. MusicKit'te taşıma yöntemi yok: `spliceQueueItems` ile
  // çıkarılıp araya eklenir (gerçek hesapta doğrulandı: çalma sırası ve olay buna uyar). Yalnızca
  // çalan şarkıdan SONRAKİ öğeler değişir; çalan şarkı ve geçmiş korunur.

  /** Sıradaki (kullanıcının eklediği) bir şarkıyı taşır; otomatik çalma bölümüne geçemez. */
  moveQueueItem(from: number, to: number): void {
    if (from === to) return
    const { position, autoplayIndex, items } = this.queueSnapshot()
    const end = autoplayIndex ?? items.length
    const ok = (i: number): boolean => Number.isInteger(i) && i > position && i < end
    if (!ok(from) || !ok(to)) throw new CoreError('INVALID_ARGUMENT', 'Geçersiz sıra numarası.')
    const splice = this.requireSplice()
    const raw = this.rawIndexes()
    const moved = splice(raw[from]!, 1)
    splice(raw[to]!, 0, moved)
  }

  /** Sıradaki veya otomatik çalma bölümündeki bir şarkıyı kuyruktan çıkarır. */
  removeQueueItem(index: number): void {
    const { position, items } = this.queueSnapshot()
    if (!Number.isInteger(index) || index <= position || index >= items.length) {
      throw new CoreError('INVALID_ARGUMENT', 'Geçersiz sıra numarası.')
    }
    this.requireSplice()(this.rawIndexes()[index]!, 1)
  }

  /** "Temizle": kullanıcının sıradakilerini boşaltır; çalan şarkı ve otomatik çalma kalır. */
  clearUpNext(): void {
    const { position, autoplayIndex, items } = this.queueSnapshot()
    const end = autoplayIndex ?? items.length
    if (end <= position + 1) return
    const raw = this.rawIndexes()
    const start = raw[position + 1]!
    this.requireSplice()(start, raw[end - 1]! - start + 1)
  }

  private requireSplice(): (start: number, count: number, items?: unknown[]) => unknown[] {
    const queue = this.music.queue
    if (typeof queue?.spliceQueueItems !== 'function') {
      throw new CoreError('PLAYER_UNAVAILABLE', 'Kuyruk düzenlenemiyor (MusicKit sürümü).')
    }
    return (start, count, items) =>
      items ? queue.spliceQueueItems!(start, count, items) : queue.spliceQueueItems!(start, count)
  }

  /** Görünen sıra → MusicKit kuyruğundaki gerçek sıra (çevrilemeyen öğeler görünmez). */
  private rawIndexes(): number[] {
    const out: number[] = []
    ;(this.music.queue?.items ?? []).forEach((raw, i) => {
      if (toNowPlaying(raw)) out.push(i)
    })
    return out
  }

  // --- Kontroller --------------------------------------------------------------------------

  play(): Promise<void> {
    return this.run('Çalma başlatılamadı.', async () => {
      await this.queueChain // süren kuyruk kurulumu (ör. geri yükleme) bitsin
      await this.beforePlayback()
      const pending = this.pendingStart
      this.pendingStart = null
      await (pending === null ? this.music.play() : this.music.changeToMediaAtIndex(pending))
      const resume = this.resumeAt
      this.resumeAt = null
      if (resume && this.music.nowPlayingItemIndex === resume.index) {
        await this.music.seekToTime(resume.seconds)
      }
    })
  }

  async pause(): Promise<void> {
    await this.run('Duraklatılamadı.', async () => void (await this.music.pause()))
  }

  async stop(): Promise<void> {
    await this.run('Durdurulamadı.', async () => void (await this.music.stop()))
  }

  next(): Promise<void> {
    this.resumeAt = null
    this.pendingStart = null
    return this.run(
      'Sonraki şarkıya geçilemedi.',
      async () => void (await this.music.skipToNextItem())
    )
  }

  previous(): Promise<void> {
    this.resumeAt = null
    this.pendingStart = null
    return this.run(
      'Önceki şarkıya geçilemedi.',
      async () => void (await this.music.skipToPreviousItem())
    )
  }

  seek(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds)) {
      return Promise.reject(new CoreError('INVALID_ARGUMENT', 'Geçersiz konum.'))
    }
    const target = Math.max(0, seconds)
    this.resumeAt = null
    return this.run(
      'Konum değiştirilemedi.',
      async () => void (await this.music.seekToTime(target))
    )
  }

  /** 0..1 aralığına kırpılır. */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) throw new CoreError('INVALID_ARGUMENT', 'Geçersiz ses düzeyi.')
    this.music.volume = Math.min(1, Math.max(0, volume))
    this.emitSettings()
  }

  setShuffle(enabled: boolean): void {
    this.music.shuffleMode = enabled ? ShuffleMode.songs : ShuffleMode.off
    this.emitSettings()
  }

  setRepeat(mode: RepeatModeName): void {
    this.music.repeatMode = RepeatMode[mode]
    this.emitSettings()
  }

  private emitSettings(): void {
    const { volume, shuffle, repeat } = this.snapshot()
    this.emit('settingsDidChange', { volume, shuffle, repeat })
  }

  // --- İç ----------------------------------------------------------------------------------

  /** `targetId`: `startWith`'teki öğenin id'si (biliniyorsa; karıştırma düzeltmesi için). */
  private startQueue(
    options: Parameters<MusicKitInstance['setQueue']>[0],
    targetId?: string
  ): Promise<void> {
    this.resumeAt = null
    this.pendingStart = null
    return this.enqueueQueueOp(() =>
      this.run('Kuyruk oluşturulamadı veya çalma başlatılamadı.', async () => {
        // setQueue ağ isteği yapar (401/429/ağ yönetimi için guarded); play() ayrıca çalma hatalarını fırlatır.
        await guarded(() => this.music.setQueue(options), 'Kuyruk oluşturulamadı.')
        const fixed = this.shuffledStartIndex(options.startWith, targetId)
        await this.beforePlayback()
        await (fixed === null ? this.music.play() : this.music.changeToMediaAtIndex(fixed))
      })
    )
  }

  /**
   * MusicKit hatası (2026-10-15, gerçek hesapla ölçüldü; geliştirici: "sanatçı sayfasında bastığımı
   * değil rastgele bir şarkı çalıyor"): karıştırma açıkken `setQueue({ startWith: k })` seçilen öğeyi
   * kuyruğun BAŞINA koyuyor ama çalma konumunu k'da bırakıyor → `play()` k. sıradaki rastgele öğeyi
   * çalar. Seçilen öğenin gerçek sırasını döner; düzeltme gerekmiyorsa `null`. id bilinmiyorsa
   * (albüm / playlist) MusicKit'in koyduğu yer: 0.
   */
  private shuffledStartIndex(startWith: number | undefined, targetId?: string): number | null {
    if (!startWith || this.music.shuffleMode === ShuffleMode.off) return null
    const items = this.music.queue.items
    const at = this.music.nowPlayingItemIndex
    const isTarget = (item: MediaItem | undefined): boolean =>
      item !== undefined &&
      targetId !== undefined &&
      [item.id, item.playParams?.id, item.attributes?.playParams?.id].includes(targetId)
    if (targetId !== undefined && isTarget(items[at])) return null
    const found = targetId === undefined ? -1 : items.findIndex(isTarget)
    const index = found >= 0 ? found : 0
    return index === at ? null : index
  }

  private async run(message: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      const error = toCoreError(err, 'PLAYBACK_FAILED', message)
      this.emit('error', error)
      throw error
    }
  }

  private requireId(id: string, what: string): string {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new CoreError('INVALID_ARGUMENT', `${what} boş olamaz.`)
    }
    return id.trim()
  }

  private requireIndex(index: number): number {
    if (!Number.isInteger(index) || index < 0) {
      throw new CoreError('INVALID_ARGUMENT', 'Geçersiz sıra numarası.')
    }
    return index
  }

  private stateName(): PlaybackStateName {
    return nameOf(PlaybackState, this.music.playbackState) ?? 'none'
  }

  private queueSnapshot(): QueueSnapshot {
    const queue = this.music.queue
    const autoplay = new Set(queue?.autoplayItems ?? [])
    const items: NowPlaying[] = []
    let autoplayIndex: number | null = null
    for (const raw of queue?.items ?? []) {
      const item = toNowPlaying(raw)
      if (!item) continue
      if (autoplayIndex === null && autoplay.has(raw)) autoplayIndex = items.length
      items.push(item)
    }
    return { items, position: queue?.position ?? 0, autoplayIndex }
  }

  private onMusicKitEvent(name: HandledEvent, event: unknown): void {
    switch (name) {
      case 'playbackStateDidChange': {
        const state = this.stateName()
        const previous = this.previousState
        this.previousState = state
        this.emit('playbackStateDidChange', { state, previous })
        break
      }
      case 'nowPlayingItemDidChange':
        this.emit('nowPlayingItemDidChange', toNowPlaying(this.music.nowPlayingItem))
        break
      case 'playbackTimeDidChange':
        this.emit('playbackTimeDidChange', {
          currentTime: this.music.currentPlaybackTime || 0,
          duration: this.music.currentPlaybackDuration || 0
        })
        break
      case 'queueItemsDidChange':
      case 'queuePositionDidChange':
        this.emit('queueItemsDidChange', this.queueSnapshot())
        break
      case 'mediaPlaybackError': {
        // EME/DRM hata kodlarını logla (PLAN 1.6). Yanıt gövdesi/token loglanmaz: yalnızca kod ve mesaj.
        const e = event as { errorCode?: unknown; message?: unknown; name?: unknown } | null
        const code = typeof e?.errorCode === 'string' ? e.errorCode : 'UNKNOWN'
        const text = typeof e?.message === 'string' ? e.message : ''
        // Hesapta başka cihaz çalıyor: ayrı kod (kullanıcıya doğru mesaj, PLAN 2.3 gözlemi).
        const streamLimit = code === 'STREAM_UPSELL' || code === 'DEVICE_LIMIT'
        const error = streamLimit
          ? new CoreError('PLAYBACK_STREAM_LIMIT', `Çalma hatası (${code}): eşzamanlı akış sınırı`)
          : toCoreError(
              event,
              'PLAYBACK_FAILED',
              `Çalma hatası (${code})${text ? `: ${text}` : ''}`
            )
        // Olay nesnesinin kendisi loglanmaz; yalnızca kod, ad ve mesaj.
        logError(
          'player',
          new CoreError(
            error.code,
            `mediaPlaybackError code=${code} name=${String(e?.name)} message=${text}`
          )
        )
        this.emit('error', error)
        break
      }
    }
  }
}
