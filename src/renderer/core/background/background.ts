import {
  TrackRefSchema,
  type BackgroundProgress,
  type SummaryLang,
  type TrackBackground,
  type TrackRef
} from '@shared/background'
import type { WorkerApi, WorkerResult } from '@shared/ipc-contract'
import type { IpcResult } from '@shared/types'
import { fromWireError, toCoreError, type CoreError } from '../errors'
import type { NowPlaying, Player } from '../musickit/player'

// Müzik arka planı istemcisi (PLAN 3.A7). Veri worker'dan gelir: cache'te varsa anında (SWR),
// arka planda yenilenince `onChanged` bildirilir. Renderer dış kaynaklara doğrudan çıkmaz.
// UI'dan bağımsızdır; gösterim katmanı metinleri yalnızca textContent ile basar.

export type { BackgroundProgress, TrackBackground, TrackRef }
export type BackgroundResult = WorkerResult<'getBackground'>

export class BackgroundClient {
  constructor(private readonly api: WorkerApi = window.api.worker) {}

  /**
   * Arka planı getirir. `onProgress` verilirse her aşama (eşleştirme, krediler, özet, opsiyoneller)
   * bitince ara sonuç bildirilir; dinleyici çağrı bitince (hatada da) sökülür. Çalan şarkı değişip
   * yeni şarkı istenirse eski çağrı `BG_CANCELLED` koduyla biter (hata değil, yok sayılmalı).
   */
  async get(
    track: TrackRef,
    lang: SummaryLang,
    onProgress?: (progress: BackgroundProgress) => void
  ): Promise<BackgroundResult> {
    if (!onProgress) return unwrap(await this.api.getBackground({ track, lang }))
    const requestId = crypto.randomUUID()
    const off = this.api.onBackgroundProgress((p) => {
      if (p.requestId === requestId) onProgress(p)
    })
    try {
      return unwrap(await this.api.getBackground({ track, lang, requestId }))
    } finally {
      off()
    }
  }

  /** Düşük öncelikli ön yükleme; hata yalnızca döner (çalmayı etkilemez). */
  async prefetch(track: TrackRef, lang: SummaryLang): Promise<void> {
    unwrap(await this.api.prefetchBackground({ track, lang }))
  }

  /** Arka planda yenilenen sonuç değişti. Abonelikten çıkan fonksiyon döner. */
  onChanged(listener: (change: { key: string; lang: SummaryLang }) => void): () => void {
    return this.api.onBackgroundChanged(listener)
  }
}

function unwrap<T>(res: IpcResult<T>): T {
  if (res.ok) return res.value
  throw fromWireError(res.error)
}

/** Çalan öğeden eşleştirme girdisi; başlık/sanatçı yoksa `null` (kullanıcı bilgisi içermez). */
export function toTrackRef(item: NowPlaying | null | undefined): TrackRef | null {
  if (!item) return null
  const base = {
    title: item.title.trim().slice(0, 300),
    artist: item.artist.trim().slice(0, 300),
    ...(item.album.trim() ? { album: item.album.trim().slice(0, 300) } : {}),
    ...(item.durationSec > 0 && item.durationSec < 86_400
      ? { durationMs: Math.round(item.durationSec * 1000) }
      : {}),
    // V8: kütüphane öğesinde ISRC yok; worker katalog id'sinden çözer.
    ...(item.catalogId ? { appleId: item.catalogId } : {})
  }
  // Bozuk ISRC eşleşmeyi engellemesin: önce ISRC'li, olmazsa ISRC'siz.
  const withIsrc = item.isrc ? TrackRefSchema.safeParse({ ...base, isrc: item.isrc }) : null
  if (withIsrc?.success) return withIsrc.data
  const parsed = TrackRefSchema.safeParse(base)
  return parsed.success ? parsed.data : null
}

export interface PrefetchOptions {
  /** Etkin dil (sanatçı özeti için). */
  lang: () => SummaryLang
  onError?: (err: CoreError) => void
}

/** Ön yüklenmiş sayılan şarkı kimliklerinin üst sınırı (aşılınca baştan başlanır). */
const PREFETCHED_MAX = 64

/**
 * ÇALAN ve SIRADAKİ şarkıyı (bu sırayla) `prefetch` ile önden hazırlatır. Şarkı veya kuyruk değişince
 * tetiklenir; aynı şarkı (`idOf`) tekrar istenmez, hata alan bir sonraki değişiklikte yeniden denenir.
 * 2026-10-18: yalnızca sıradaki hazırlanıyordu; ilk şarkının ve panel açılmadan çalan şarkının bilgisi
 * ve sözleri panel açılınca isteniyor, LRCLIB/MusicBrainz yavaşken saniyelerce "yükleniyor" kalıyordu.
 * Döndürülen fonksiyon dinleyicileri söker.
 */
export function connectUpcomingPrefetch(
  player: Pick<Player, 'on' | 'snapshot'>,
  prefetch: (ref: TrackRef) => Promise<void>,
  idOf: (ref: TrackRef) => string,
  onError?: (err: unknown) => void
): () => void {
  const done = new Set<string>()
  const run = (): void => {
    const { items, position } = player.snapshot().queue
    for (const item of [items[position], items[position + 1]]) {
      const ref = toTrackRef(item)
      if (!ref) continue
      const id = idOf(ref)
      if (done.has(id)) continue
      if (done.size >= PREFETCHED_MAX) done.clear()
      done.add(id)
      prefetch(ref).catch((err: unknown) => {
        done.delete(id) // bir sonraki değişiklikte yeniden denensin
        onError?.(err)
      })
    }
  }
  const offs = [player.on('nowPlayingItemDidChange', run), player.on('queueItemsDidChange', run)]
  run()
  return () => offs.forEach((off) => off())
}

/** Çalan ve sıradaki şarkının arka planını düşük öncelikle ön yükler (PLAN 3.A7). */
export function connectBackgroundPrefetch(
  player: Pick<Player, 'on' | 'snapshot'>,
  client: Pick<BackgroundClient, 'prefetch'>,
  { lang, onError }: PrefetchOptions
): () => void {
  return connectUpcomingPrefetch(
    player,
    (ref) => client.prefetch(ref, lang()),
    (ref) => JSON.stringify([ref.title, ref.artist, ref.album ?? '', ref.isrc ?? '', lang()]),
    (err) =>
      onError?.(toCoreError(err, 'BG_SOURCE_UNAVAILABLE', 'Arka plan ön yüklemesi başarısız.'))
  )
}
