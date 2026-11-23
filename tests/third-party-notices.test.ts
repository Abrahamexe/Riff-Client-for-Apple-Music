import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// PLAN_v5 A2: scripts/third-party-notices.mjs geçici bir proje kökünde (sahte node_modules) çalıştırılır.
const SCRIPT = resolve('scripts/third-party-notices.mjs')

let root: string

function pkg(dir: string, json: object, license?: [string, string]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
  if (license) writeFileSync(join(dir, license[0]), license[1])
}

function run(): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const notices = (): string => readFileSync(join(root, 'build/THIRD_PARTY_NOTICES.txt'), 'utf8')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tpn-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('third-party-notices (A2)', () => {
  it('üretim bağımlılıklarının tam lisans metnini yazar; devDependencies girmez', () => {
    pkg(root, { dependencies: { alpha: '^1.0.0' }, devDependencies: { devtool: '^1.0.0' } })
    pkg(join(root, 'node_modules/alpha'), { version: '1.2.3', license: 'MIT' }, [
      'LICENSE',
      'MIT License\n\nCopyright (c) Alpha Yazarı'
    ])
    pkg(join(root, 'node_modules/devtool'), { version: '9.0.0', license: 'MIT' }, [
      'LICENSE',
      'devtool lisansı'
    ])
    const r = run()
    expect(r.status).toBe(0)
    const text = notices()
    expect(text).toContain('alpha 1.2.3 (MIT)')
    expect(text).toContain('Copyright (c) Alpha Yazarı')
    expect(text).not.toContain('devtool')
  })

  it('geçişli bağımlılıkları (iç içe node_modules dahil) kapsar; LICENSE.md adını tanır', () => {
    pkg(root, { dependencies: { alpha: '^1.0.0' } })
    pkg(
      join(root, 'node_modules/alpha'),
      { version: '1.0.0', license: 'MIT', dependencies: { beta: '^2.0.0', gamma: '^1.0.0' } },
      ['LICENSE.md', 'alpha metni']
    )
    pkg(join(root, 'node_modules/alpha/node_modules/beta'), { version: '2.0.0', license: 'ISC' }, [
      'license.txt',
      'beta metni'
    ])
    pkg(join(root, 'node_modules/gamma'), { version: '1.1.0', license: 'BSD-3-Clause' }, [
      'COPYING',
      'gamma metni'
    ])
    expect(run().status).toBe(0)
    const text = notices()
    expect(text).toContain('beta 2.0.0 (ISC)')
    expect(text).toContain('beta metni')
    expect(text).toContain('gamma 1.1.0 (BSD-3-Clause)')
  })

  it('lisans dosyası olmayan paket → hata, dosya yazılmaz', () => {
    pkg(root, { dependencies: { nolicense: '^1.0.0' } })
    pkg(join(root, 'node_modules/nolicense'), { version: '0.1.0', license: 'MIT' })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('nolicense@0.1.0: lisans dosyası yok')
    expect(() => notices()).toThrow()
  })

  it('kurulu olmayan bağımlılık → hata', () => {
    pkg(root, { dependencies: { missing: '^1.0.0' } })
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('missing')
  })

  it('gerçek proje: zod ve jose tam MIT metinleriyle', () => {
    const out = join(root, 'notices.txt')
    const r = spawnSync(process.execPath, [SCRIPT, '--out', out], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^zod \S+ \(MIT\)$/m)
    expect(text).toMatch(/^jose \S+ \(MIT\)$/m)
    expect(text).toMatch(/Copyright \(c\) .*Colin McDonnell/)
    expect(text).toMatch(/Copyright \(c\) .*Filip Skokan/)
    expect(text).toContain('Permission is hereby granted')
  })
})
