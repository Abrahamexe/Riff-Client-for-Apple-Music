import type { TrackRef } from '@shared/background'
import type { WorkerApi } from '@shared/ipc-contract'
import type { LyricLine, Lyrics } from '@shared/lyrics'
import { fromWireError } from '../errors'
import type { Player } from '../musickit/player'
import { connectUpcomingPrefetch } from './background'

// Şarkı sözleri istemcisi (B11b). Sözler worker'dan gelir (LRCLIB; renderer dış kaynağa çıkmaz).
// UI'dan bağımsızdır; satırlar yalnızca metin olarak gösterilir.

export type { LyricLine, Lyrics }

export class LyricsClient {
  constructor(private readonly api: WorkerApi = window.api.worker) {}

  /** Yeni şarkı istenince önceki istek `BG_CANCELLED` ile biter (hata değil, yok sayılmalı). */
  async get(track: TrackRef): Promise<Lyrics> {
    const res = await this.api.getLyrics({ track })
    if (res.ok) return res.value
    throw fromWireError(res.error)
  }

  /** Düşük öncelikli önden yükleme (süren `get`'i iptal etmez); hata yutulur. */
  async prefetch(track: TrackRef): Promise<void> {
    await this.api.prefetchLyrics({ track }).catch(() => {})
  }
}

const lyricsKeyOf = (ref: TrackRef): string =>
  JSON.stringify([ref.title, ref.artist, ref.album ?? '', ref.durationMs ?? 0])

/**
 * Çalan ve sıradaki şarkının sözleri panel kapalıyken de düşük öncelikle önden yüklenir (geliştirici
 * kararı 2026-10-18: "her şarkıda"; LRCLIB çalınan her şarkının adını görür, docs/PRIVACY.md). Panel
 * veya büyük oynatıcı açılınca sözler worker cache'inden anında gelir.
 */
export function connectLyricsPrefetch(
  player: Pick<Player, 'on' | 'snapshot'>,
  client: Pick<LyricsClient, 'prefetch'>
): () => void {
  return connectUpcomingPrefetch(player, (ref) => client.prefetch(ref), lyricsKeyOf)
}

let shared: LyricsClient | null = null
/** Uygulama genelinde tek istemci (panel ve oynatıcı düğmesi paylaşır). */
export const lyricsClient = (): LyricsClient => (shared ??= new LyricsClient())

/** Aynı şarkıyı tanıyan anahtar (istek tekrarı ve kaydırma sıfırlaması için). */
export function lyricsKey(ref: TrackRef | null): string | null {
  return ref ? lyricsKeyOf(ref) : null
}

/**
 * `timeMs` anında çalan satırın sırası: başlangıcı geçmiş son satır. İlk satırdan önce veya zamansız
 * (düz) sözlerde -1. Satırlar zamana göre sıralıdır (worker sıralar); ikili arama.
 */
export function activeLineIndex(lines: readonly LyricLine[], timeMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = lines[mid]!.timeMs
    if (t === null) return -1
    if (t <= timeMs) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Tıklanan satır: konum ona ulaşana kadar (en fazla `until`'e dek) vurgulu kalır. */
export interface LinePin {
  index: number
  until: number
}

/**
 * Gösterilecek çalan satır. MusicKit konumu tam saniye bildirir: 28,44 sn'deki satıra sarınca önce 28
 * gelir ve bir önceki satır kısa süre parlar. Tıklanan satır, hesaplanan satır ona ulaşana kadar ya
 * da süre dolana kadar (sarma başarısız) önceliklidir.
 */
export function shownLine(active: number, pin: LinePin | null, now: number): number {
  return pin && now < pin.until ? pin.index : active
}
