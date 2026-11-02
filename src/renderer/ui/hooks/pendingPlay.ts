import { useSyncExternalStore } from 'react'
import type { Track } from '@shared/ipc-contract'
import type { NowPlaying, PlayerSnapshot } from '@core/musickit/player'

// Bekleyen çalma (2026-10-30, geliştirici: "albüm ya da playlistten şarkı seçerken şarkı açılana kadar
// takılıyor gibi oluyor"; seçim: "anında tepki"). Satıra basınca şarkı hemen burada tutulur: satırda
// nabız atan çubuklar çıkar, alt oynatıcı yeni şarkıyı gösterir ve ilerleme çubuğunda ışık akar. Çalar
// gerçekten çalmaya başlayınca (ya da hata / zaman aşımında) gerçek duruma bırakılır.

export interface PendingPlay {
  /** Basılan şarkı (kütüphane ya da katalog id'si) ve katalog karşılığı. */
  id: string
  catalogId?: string
  title: string
  artist: string
  album: string
  artworkUrl: string | null
  durationSec: number
  /** Basıldığı anda çubukta görünen şarkının id'si (o çalmaya devam ederken bekleme bitmesin). */
  previousId: string | null
}

/** Ses en geç bu sürede gelmezse bekleme bırakılır (hata bildirimi ayrıca gelir). */
export const PENDING_TIMEOUT_MS = 12_000
/**
 * "Çalıyor" bu kadar sürmeden bekleme bitmez. Gözlem (30.10, Şarkılar sayfası): MusicKit yeni kuyrukta
 * önce bir anlığına `playing` bildirir, aynı milisaniyede `waiting` → `loading`'e döner, ses ~1 sn sonra
 * gelir; ilk `playing`'de bırakınca ışık sesten önce sönüyordu.
 */
export const SETTLE_MS = 300

export function toPending(
  track: Track,
  previous: NowPlaying | null,
  fallbackArtwork?: string | null
): PendingPlay {
  return {
    id: track.id,
    ...(track.playParams?.catalogId ? { catalogId: track.playParams.catalogId } : {}),
    title: track.name,
    artist: track.artistName,
    album: track.albumName,
    artworkUrl: track.artworkUrl ?? fallbackArtwork ?? null,
    durationSec: track.durationMs === null ? 0 : track.durationMs / 1000,
    previousId: previous?.id ?? null
  }
}

/** Bekleyen şarkı ile çalardaki şarkı aynı mı (kütüphane ↔ katalog id'si dahil). */
export function sameSong(p: PendingPlay, now: NowPlaying | null): boolean {
  if (!now) return false
  return (
    p.id === now.id ||
    (p.catalogId !== undefined && (p.catalogId === now.catalogId || p.catalogId === now.id))
  )
}

/**
 * Bekleme bitti mi: çalar çalıyor ve çalan şarkı ya basılan şarkı ya da basılmadan önceki şarkıdan
 * farklı bir şarkı (ör. karıştırma başka şarkıdan başlattı). Basılmadan önce çalan şarkı sürerken
 * bitmez (MusicKit onu birkaç yüz ms daha "playing" bildirir).
 */
export function settled(p: PendingPlay, snapshot: PlayerSnapshot | null): boolean {
  if (!snapshot || snapshot.state !== 'playing' || !snapshot.nowPlaying) return false
  return sameSong(p, snapshot.nowPlaying) || snapshot.nowPlaying.id !== p.previousId
}

/** Çubukta gösterilecek şarkı: bekleyen varsa o (çalar henüz eski şarkıdayken). */
export function pendingAsNowPlaying(p: PendingPlay): NowPlaying {
  return {
    id: p.id,
    title: p.title,
    artist: p.artist,
    album: p.album,
    artworkTemplate: p.artworkUrl,
    durationSec: p.durationSec,
    playbackType: 'unknown',
    ...(p.catalogId ? { catalogId: p.catalogId } : {})
  }
}

// ---- Tek, küçük dış depo (tüm pencere için bir bekleyen şarkı) -------------------------------------

let current: PendingPlay | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export const pendingPlay = {
  get: (): PendingPlay | null => current,
  set: (p: PendingPlay): void => {
    current = p
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => pendingPlay.clear(), PENDING_TIMEOUT_MS)
    emit()
  },
  clear: (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!current) return
    current = null
    emit()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

export function usePendingPlay(): PendingPlay | null {
  return useSyncExternalStore(pendingPlay.subscribe, pendingPlay.get)
}
