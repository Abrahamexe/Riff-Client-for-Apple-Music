import { createZip } from './zip'
import { sanitizeLogLine, type LogSink } from './logSink'

// Tanılama paketi (PLAN 2.3): tek tıkla yerel .zip. İçerik: sürümler, CDM durumu, güvenli mod, son
// hata kodları ve maskeli loglar. Token, e-posta, kütüphane içeriği, DB, çökme dökümleri (bellek
// içerebilir) YOK; otomatik gönderim YOK (izinli gönderim Faz 4.6). Kullanıcı dosyayı kendisi paylaşır.

export interface DiagnosticsInput {
  sink: Pick<LogSink, 'snapshot'>
  versions: Record<string, string>
  cdm: { state: string }
  safeMode: boolean
  now?: () => Date
}

/** Log metnindeki katalog hata kimlikleri (ör. `NET_001 OFFLINE`), en yeni sonda, en fazla 100. */
export function recentErrorIds(log: string, limit = 100): string[] {
  const ids = log.match(/\b[A-Z]{2,5}_[0-9]{3} [A-Z_]{3,40}\b/g) ?? []
  return ids.slice(-limit)
}

export async function buildDiagnostics(input: DiagnosticsInput): Promise<Buffer> {
  const logs = await input.sink.snapshot()
  const errors = recentErrorIds(logs)
  const counts: Record<string, number> = {}
  for (const id of errors) counts[id] = (counts[id] ?? 0) + 1
  const info = {
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    versions: input.versions,
    cdm: input.cdm.state,
    safeMode: input.safeMode,
    recentErrorCounts: counts,
    note: 'Token, e-posta, kütüphane içeriği ve çökme dökümleri bu pakete dahil değildir.'
  }
  return createZip([
    { name: 'info.json', data: sanitizeLogLine(JSON.stringify(info, null, 2)) },
    { name: 'errors.txt', data: errors.join('\n') + '\n' },
    { name: 'logs/app.log', data: logs }
  ])
}

/** Dosya adı: `RiffClient-tanilama-20261012-193512.zip` (kişisel veri yok). */
export function diagnosticsFileName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `RiffClient-tanilama-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.zip`
}
