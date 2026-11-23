// Çalma bağlantısını ısıtma, renderer tarafı (2026-10-14). Kullanıcı çalmaya niyetlenince (açılış,
// pencere öne gelme, şarkı / kart / oynatıcı üzerine gelme) main'den ön bağlantı istenir; main sabit
// Apple origin'lerine DNS + TLS bağlantısı açar (`main/playbackWarmup.ts`, gerekçe ve ölçüm orada).
// Burada yalnızca gereksiz IPC'yi önleyen sıklık sınırı: `minIntervalMs` içinde bir istek.

export interface WarmupOptions {
  minIntervalMs?: number
  now?: () => number
  /** Main'den ısıtma ister (varsayılan: preload'daki dar kanal). */
  request?: () => Promise<unknown>
}

export function createWarmup({
  minIntervalMs = 20_000,
  now = () => performance.now(),
  request = () => window.api.warmupPlayback()
}: WarmupOptions = {}): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < minIntervalMs) return false
    last = t
    // Isıtma yalnızca hız kazancı: başarısız olursa çalma yine olağan yolla başlar.
    request().catch(() => {})
    return true
  }
}
