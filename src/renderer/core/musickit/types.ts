// MusicKit JS v3 için resmi TypeScript tipi yok; yalnızca kullandığımız yüzey burada tanımlı
// (değerler musickit.js v3'ten doğrulandı). Tüm MusicKit erişimi core/musickit/ içinde izole kalır.

export interface MusicKitApiResponse {
  data: unknown
}

/** MusicKit `PlaybackStates` */
export const PlaybackState = {
  none: 0,
  loading: 1,
  playing: 2,
  paused: 3,
  stopped: 4,
  ended: 5,
  seeking: 6,
  waiting: 8,
  stalled: 9,
  completed: 10
} as const

/** MusicKit `PlayerRepeatMode` */
export const RepeatMode = { none: 0, one: 1, all: 2 } as const

/** MusicKit `PlayerShuffleMode` */
export const ShuffleMode = { off: 0, songs: 1 } as const

/** MusicKit `PlaybackType`: `encryptedFull` = tam şarkı (DRM'li), `preview` = 30 sn önizleme. */
export const PlaybackType = { none: 0, preview: 1, unencryptedFull: 2, encryptedFull: 3 } as const

export interface MediaItem {
  id: string
  title?: string
  artistName?: string
  albumName?: string
  /** `{w}x{h}` şablonlu URL. */
  artwork?: { url?: string }
  attributes?: {
    name?: string
    artistName?: string
    albumName?: string
    artwork?: { url?: string }
    /** Apple Music API `Songs.Attributes.isrc` (arka plan eşleştirmesi, PLAN 3.A2). */
    isrc?: string
    /** Kütüphane öğesinde `catalogId` katalog şarkı id'sidir (V8 gözlemi). */
    playParams?: { id?: string; kind?: string; catalogId?: string }
  }
  playParams?: { id?: string; kind?: string; catalogId?: string }
  playbackType?: number
  /** ms */
  playbackDuration?: number
}

export interface QueueOptions {
  song?: string
  songs?: string[]
  album?: string
  playlist?: string
  /** Radyo istasyonu (`ra.…`); sonsuz akış. */
  station?: string
  /** Kuyrukta bu indeksteki öğeden başla. */
  startWith?: number
  startPlaying?: boolean
}

export type MusicKitEventName =
  | 'playbackStateDidChange'
  | 'nowPlayingItemDidChange'
  | 'playbackTimeDidChange'
  | 'playbackDurationDidChange'
  | 'queueItemsDidChange'
  | 'queuePositionDidChange'
  | 'playbackVolumeDidChange'
  | 'mediaPlaybackError'
  | 'userTokenDidChange'
  | 'authorizationStatusDidChange'

export interface MusicKitInstance {
  readonly api: {
    music(path: string, params?: Record<string, unknown>): Promise<MusicKitApiResponse>
  }
  /** Katalog istekleri bu mağazaya gider (kullanıcı mağazasından türetilir). */
  readonly storefrontId: string
  /** Hesap + abonelik (`/me/account`); kullanıcı mağazasını ayarlar, önbelleğe alınır (2.1 bulgusu). */
  me(): Promise<unknown>
  readonly isAuthorized: boolean
  /** Atanınca MusicKit oturumu bu token ile yetkilendirilmiş sayar (kayıtlı oturumu geri yüklemek için). */
  musicUserToken: string | undefined
  /** Hesabın içerik kısıtlaması (explicit içerik); atanınca MusicKit'in tahmini geçersiz kılınır. */
  restrictedEnabled: boolean | undefined
  /** Akış kalitesi (kbps): `PlaybackBitrate` HIGH = 256, STANDARD = 64 (3.B3 gözlemi). */
  bitrate: number
  /** Kuyruk bitince benzer müzikle devam (Apple: Sıradaki ∞). */
  autoplayEnabled: boolean
  /** Açıkken çalınanlar Apple dinleme geçmişine/önerilere yansımaz (Apple: "Dinleme geçmişini kullan" kapalı). */
  privateEnabled: boolean
  /** Apple giriş penceresini açar; başarılıysa Music User Token döner. */
  authorize(): Promise<string>
  unauthorize(): Promise<void>

  // Çalma
  setQueue(options: QueueOptions): Promise<unknown>
  /** Çalan öğeden hemen sonraya ekler (Apple "Sıradaki Çal"; çalışma zamanında doğrulandı). */
  playNext(options: QueueOptions): Promise<unknown>
  /** Kuyruğun sonuna ekler (Apple "Sonra Çal"). */
  playLater(options: QueueOptions): Promise<unknown>
  play(): Promise<unknown>
  pause(): void | Promise<void>
  stop(): void | Promise<void>
  skipToNextItem(): Promise<unknown>
  skipToPreviousItem(): Promise<unknown>
  seekToTime(seconds: number): Promise<unknown>
  changeToMediaAtIndex(index: number): Promise<unknown>
  volume: number
  shuffleMode: number
  repeatMode: number
  readonly playbackState: number
  readonly isPlaying: boolean
  readonly nowPlayingItem: MediaItem | undefined
  readonly nowPlayingItemIndex: number
  /** saniye */
  readonly currentPlaybackTime: number
  readonly currentPlaybackDuration: number
  readonly queue: {
    items: MediaItem[]
    position: number
    /**
     * P3 gözlemi (2026-10-13): otomatik çalma öğeleri (`autoplayEnabled`); kuyrukta kullanıcının
     * öğelerinden sonra bitişik. Eski/sahte sürümlerde olmayabilir.
     */
    autoplayItems?: MediaItem[]
    /**
     * §3.2 gözlemi (2026-10-14, gerçek hesap): `Array.splice` gibi; MusicKit'in iç kuyruk öğelerini
     * çıkarır / ekler, çalma sırası ve `queueItemsDidChange` buna uyar. Taşıma yöntemi yok.
     */
    spliceQueueItems?(start: number, deleteCount: number, items?: unknown[]): unknown[]
  }

  addEventListener(name: MusicKitEventName, listener: (event: unknown) => void): void
  removeEventListener(name: MusicKitEventName, listener: (event: unknown) => void): void
}

export interface MusicKitConfig {
  developerToken: string
  app: { name: string; build: string }
}

export interface MusicKitStatic {
  configure(config: MusicKitConfig): Promise<MusicKitInstance>
  getInstance(): MusicKitInstance
}

declare global {
  interface Window {
    MusicKit?: MusicKitStatic
  }
}
