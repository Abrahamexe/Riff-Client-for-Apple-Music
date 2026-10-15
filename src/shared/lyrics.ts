import { z } from 'zod/mini'

// Şarkı sözleri modeli (B11b). Apple'ın sözleri üçüncü taraf geliştirici anahtarına kapalı; sözler
// LRCLIB'den (https://lrclib.net) gelir. Worker çözümler, renderer yalnızca gösterir. Metinler dış
// veridir: her zaman düz metin olarak (textContent) render edilir.

/** `synced`: satır zamanlı; `plain`: zamansız metin; `instrumental`: sözsüz parça; `none`: bulunamadı. */
const LYRICS_KINDS = ['synced', 'plain', 'instrumental', 'none'] as const
export type LyricsKind = (typeof LYRICS_KINDS)[number]

/** Bir söz satırı. `timeMs`: senkron sözlerde satırın başladığı an; düz metinde `null`. Boş metin = ara. */
export const LyricLineSchema = z.object({
  timeMs: z.nullable(z.number().check(z.int(), z.gte(0), z.lte(86_400_000))),
  text: z.string().check(z.maxLength(1_000))
})
export type LyricLine = z.infer<typeof LyricLineSchema>

/** Bir şarkıda en fazla bu kadar satır gösterilir (bozuk/kötü niyetli dev gövdeye karşı). */
export const MAX_LYRIC_LINES = 2_000

export const LyricsSchema = z.object({
  kind: z.enum(LYRICS_KINDS),
  lines: z.array(LyricLineSchema).check(z.maxLength(MAX_LYRIC_LINES))
})
export type Lyrics = z.infer<typeof LyricsSchema>

export const NO_LYRICS: Lyrics = { kind: 'none', lines: [] }
