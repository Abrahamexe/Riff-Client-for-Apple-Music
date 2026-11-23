import { PLAYBACK_WARMUP_ORIGINS } from '@shared/app-config'

// Çalma bağlantısını ısıtma (2026-10-14). Ölçüm: geliştiricinin DNS sunucusu (bağlantı paylaşımı) her
// alan adı için 1,8–5,9 sn bekletiyor ve TTL=0 döndürüyor (Windows önbelleğe almıyor); bir süre
// çalınmadıktan sonra şarkıya basınca Apple'ın ses sunucusuna ilk istek 4–9,7 sn sürüyordu. Renderer'dan
// `<link rel="preconnect">` etkisizdi; uygulama oturumundan `session.preconnect` ile 0,3–0,4 sn.
// Renderer niyet bildirince (açılış, pencere öne gelme, şarkı üzerine gelme) sabit origin'lere DNS +
// TLS ön bağlantısı açılır; veri gitmez. Sıklık sınırı: `minIntervalMs` içinde bir kez.

export interface PlaybackWarmupOptions {
  preconnect: (url: string) => void
  origins?: readonly string[]
  minIntervalMs?: number
  now?: () => number
}

export function createPlaybackWarmup({
  preconnect,
  origins = PLAYBACK_WARMUP_ORIGINS,
  minIntervalMs = 10_000,
  now = Date.now
}: PlaybackWarmupOptions): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < minIntervalMs) return false
    last = t
    for (const url of origins) preconnect(url)
    return true
  }
}
