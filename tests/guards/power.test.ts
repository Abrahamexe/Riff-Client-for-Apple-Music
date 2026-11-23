import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatSample, summarizeCpu } from '../../src/main/dev/cpuSampler'

// PLAN 1.8b: worker boşta iken periyodik iş yapmaz (senkronizasyon okuma tetiklemeli, SWR).
// Üretim kodunda periyodik zamanlayıcı yalnızca gerekçeli dev araçlarında bulunabilir.

const ROOT = resolve(__dirname, '../..')
const ALLOWED_PERIODIC = new Set(['src/main/dev/cpuSampler.ts'])

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* sources(path)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path
  }
}

describe('enerji tasarrufu (1.8b)', () => {
  it('üretim kodunda setInterval yok (worker ve renderer olay tabanlı)', () => {
    const offenders: string[] = []
    for (const file of sources(join(ROOT, 'src'))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      if (ALLOWED_PERIODIC.has(rel)) continue
      if (/\bsetInterval\s*\(/.test(readFileSync(file, 'utf8'))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('CPU örnekleyici süreç tiplerine göre toplar', () => {
    const metrics = [
      { type: 'Browser', cpu: { percentCPUUsage: 1.04 } },
      { type: 'Tab', cpu: { percentCPUUsage: 2 } },
      { type: 'Tab', cpu: { percentCPUUsage: 0.51 } },
      { type: 'Utility', cpu: { percentCPUUsage: 0 } }
    ]
    expect(summarizeCpu(metrics)).toEqual({ Browser: 1, Tab: 2.5, Utility: 0 })
    expect(formatSample(false, metrics)).toBe(
      '[cpu] pencere=gizli toplam=3.5% Browser=1% Tab=2.5% Utility=0%'
    )
  })
})
