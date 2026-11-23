// Uyku/uyanma ve ağ değişimi sonrası toparlanma (PLAN 2.3). UI'dan bağımsızdır.
//  - Sinyaller: main'den `system:resume` (powerMonitor) ve tarayıcının `online` olayı; kısa sürede
//    gelen tekrarlar tek sinyale indirgenir.
//  - Yapılacaklar: MusicKit hiç yüklenemediyse yeniden yüklenir; uzun süredir yapılandırılmışsa
//    developer token tazelenip MusicKit yeniden yapılandırılır (kullanıcı token'ı korunur); kütüphane
//    senkronu tetiklenir (SWR: yerel veri gösterilmeye devam eder).

export type ReconnectReason = 'resume' | 'online'

export interface ReconnectSources {
  onSystemResume(listener: (payload: { reason: 'resume' }) => void): () => void
  window: {
    addEventListener(type: 'online', listener: () => void): void
    removeEventListener(type: 'online', listener: () => void): void
  }
}

/** İki sinyali birleştirir; `throttleMs` içinde gelen tekrarları yutar. Abonelikten çıkış döner. */
export function onReconnect(
  sources: ReconnectSources,
  listener: (reason: ReconnectReason) => void,
  { throttleMs = 5_000, now = Date.now }: { throttleMs?: number; now?: () => number } = {}
): () => void {
  let last = -Infinity
  const fire = (reason: ReconnectReason): void => {
    const t = now()
    if (t - last < throttleMs) return
    last = t
    listener(reason)
  }
  const onOnline = (): void => fire('online')
  const offResume = sources.onSystemResume(() => fire('resume'))
  sources.window.addEventListener('online', onOnline)
  return () => {
    offResume()
    sources.window.removeEventListener('online', onOnline)
  }
}

export interface RefreshDeps {
  isMusicKitLoaded(): boolean
  loadMusicKit(): Promise<unknown>
  /** Son başarılı `configure` zamanı (ms) veya hiç yapılandırılmadıysa `null`. */
  configuredAt(): number | null
  reconfigure(): Promise<unknown>
  syncLibrary(): Promise<unknown>
  /** Çevrimdışıyken kuyruğa alınan kütüphane yazmaları (3.B2); senkronizasyondan ÖNCE gönderilir. */
  flushPendingWrites?(): Promise<unknown>
  now?: () => number
  /** Bu süreden eski yapılandırmada developer token tazelenir (varsayılan 1 sa). */
  maxConfigAgeMs?: number
}

export type RefreshAction = 'loadMusicKit' | 'reconfigure' | 'flushWrites' | 'syncLibrary'

/** Yeniden bağlanınca gerekenleri yapar; hata bir sonrakini engellemez. Yapılanları döner. */
export async function refreshAfterReconnect(deps: RefreshDeps): Promise<RefreshAction[]> {
  const done: RefreshAction[] = []
  const now = (deps.now ?? Date.now)()
  try {
    if (!deps.isMusicKitLoaded()) {
      await deps.loadMusicKit()
      done.push('loadMusicKit')
    } else {
      const at = deps.configuredAt()
      if (at !== null && now - at > (deps.maxConfigAgeMs ?? 60 * 60_000)) {
        await deps.reconfigure()
        done.push('reconfigure')
      }
    }
  } catch {
    /* MusicKit hâlâ yüklenemiyor: bir sonraki sinyalde yeniden denenir */
  }
  if (deps.flushPendingWrites) {
    try {
      await deps.flushPendingWrites()
      done.push('flushWrites')
    } catch {
      /* hâlâ çevrimdışı: kuyruk korunur */
    }
  }
  try {
    await deps.syncLibrary()
    done.push('syncLibrary')
  } catch {
    /* çevrimdışı: yerel veri kullanılmaya devam eder */
  }
  return done
}
