// YALNIZCA DEV BUILD (PLAN 1.8b ölçümü): `--cpu-sample` ile her süreç tipinin CPU kullanımını
// periyodik olarak loglar; ana pencere görünür/gizli durumu satıra eklenir. Gizliyken ve görünürken
// ölçülen değerler docs/PERFORMANCE.md'ye yazılır. Production bundle'ında bu modül yoktur.
//
// Kullanım (Apple key + EVS gelince): `npm run dev -- -- --cpu-sample`, bir şarkı çal, pencereyi
// birkaç dakika açık tut, sonra kapat (gizle) ve aynı süre bekle.

/** Electron `ProcessMetric`'in kullandığımız yüzeyi. */
export interface MetricLike {
  type: string
  cpu: { percentCPUUsage: number }
}

/** Süreç tipine göre toplam CPU yüzdesi (ör. { Browser: 1.2, Tab: 3.4, Utility: 0.1 }). */
export function summarizeCpu(metrics: readonly MetricLike[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const m of metrics) {
    totals[m.type] = Math.round(((totals[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10
  }
  return totals
}

export function formatSample(visible: boolean, metrics: readonly MetricLike[]): string {
  const totals = summarizeCpu(metrics)
  const total = Math.round(Object.values(totals).reduce((a, b) => a + b, 0) * 10) / 10
  const parts = Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, cpu]) => `${type}=${cpu}%`)
  return `[cpu] pencere=${visible ? 'görünür' : 'gizli'} toplam=${total}% ${parts.join(' ')}`
}

/** Örneklemeyi başlatır; döndürülen fonksiyon durdurur. */
export function startCpuSampler(
  getMetrics: () => readonly MetricLike[],
  isMainVisible: () => boolean,
  intervalMs = 5_000
): () => void {
  const timer = setInterval(() => {
    console.info(formatSample(isMainVisible(), getMetrics()))
  }, intervalMs)
  return () => clearInterval(timer)
}
