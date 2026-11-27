// Gözlemevi büyük oynatıcısının uyduları (2026-11-27, geliştirici: "daireyi kaldıralım, uydu mantığı
// kalsın, daha işlevsel olsun"): kapağın iki yanında sıradaki şarkılar; basınca o şarkıya geçilir.
// Saf seçim (testli); çizim Satellites.tsx.

export interface SatelliteItem<T> {
  item: T
  /** Kuyruktaki sırası (`player.playQueueIndex`). */
  index: number
}

/** Çalan şarkıdan sonraki en çok `count` şarkı; konum geçersizse baştan sayılır. */
export function satelliteItems<T>(
  items: readonly T[],
  position: number,
  count = 2
): SatelliteItem<T>[] {
  const start = Math.max(0, Number.isFinite(position) ? Math.trunc(position) : 0) + 1
  const out: SatelliteItem<T>[] = []
  for (let i = start; i < items.length && out.length < count; i++) {
    out.push({ item: items[i]!, index: i })
  }
  return out
}
