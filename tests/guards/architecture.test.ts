import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { cruise, type IConfiguration, type ICruiseResult } from 'dependency-cruiser'
import { ESLint } from 'eslint'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// PLAN 1.1a kabul: kasıtlı bir sınır ihlali ve kasıtlı bir floating promise `npm run check`'i
// başarısız yapıyor. Gerçek yapılandırma dosyaları (.dependency-cruiser.cjs, eslint.config.mjs)
// kullanılır; kasıtlı ihlaller geçici klasörde veya bellekte (lintText) üretilir, src/'ye yazılmaz.

const ROOT = resolve(__dirname, '../..')
const require = createRequire(import.meta.url)
const depcruiseConfig = require(join(ROOT, '.dependency-cruiser.cjs')) as IConfiguration

let fixtureDir = ''

async function fixture(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(fixtureDir, 'case-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  return dir
}

async function violations(files: Record<string, string>): Promise<string[]> {
  const baseDir = await fixture(files)
  const { output } = await cruise(['src'], {
    baseDir,
    validate: true,
    ruleSet: { forbidden: depcruiseConfig.forbidden ?? [] },
    tsPreCompilationDeps: true
  })
  return (output as ICruiseResult).summary.violations.map((v) => v.rule.name).sort()
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'am-guards-'))
})
afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true })
})

describe('dependency-cruiser sınırları', () => {
  it('renderer → main import ihlal sayılır', async () => {
    expect(
      await violations({
        'src/main/secret.ts': 'export const x = 1\n',
        'src/renderer/core/bad.ts': "import { x } from '../../main/secret'\nexport const y = x\n"
      })
    ).toContain('no-renderer-to-other-process')
  })

  it('worker → main ve main → worker ihlal sayılır (tip import dahil)', async () => {
    const v = await violations({
      'src/main/a.ts': "import type { B } from '../worker/b'\nexport type A = B\n",
      'src/worker/b.ts': "import { c } from '../main/c'\nexport type B = typeof c\n",
      'src/main/c.ts': 'export const c = 1\n'
    })
    expect(v).toEqual(
      expect.arrayContaining(['no-main-to-other-process', 'no-worker-to-other-process'])
    )
  })

  it('renderer/core → debug ihlal sayılır', async () => {
    expect(
      await violations({
        'src/renderer/debug/panel.ts': 'export const p = 1\n',
        'src/renderer/core/x.ts': "import { p } from '../debug/panel'\nexport const q = p\n"
      })
    ).toContain('renderer-core-no-ui')
  })

  it('shared → süreç kodu ve Node modülü ihlal sayılır', async () => {
    const v = await violations({
      'src/main/m.ts': 'export const m = 1\n',
      'src/shared/s.ts':
        "import { m } from '../main/m'\nimport { join } from 'node:path'\nexport const s = join(String(m))\n"
    })
    expect(v).toEqual(expect.arrayContaining(['shared-is-leaf', 'renderer-no-node']))
  })

  it('döngüsel bağımlılık ihlal sayılır', async () => {
    expect(
      await violations({
        'src/worker/a.ts': "import { b } from './b'\nexport const a = () => b\n",
        'src/worker/b.ts': "import { a } from './a'\nexport const b = () => a\n"
      })
    ).toContain('no-circular')
  })

  it('izinli bağımlılıklar temiz', async () => {
    expect(
      await violations({
        'src/shared/t.ts': 'export const t = 1\n',
        'src/main/platform/p.ts': 'export const p = 1\n',
        'src/main/m.ts':
          "import { t } from '../shared/t'\nimport { p } from './platform/p'\nexport const m = t + p\n",
        'src/renderer/core/c.ts': "import { t } from '../../shared/t'\nexport const c = t\n",
        'src/renderer/debug/d.ts': "import { c } from '../core/c'\nexport const d = c\n"
      })
    ).toEqual([])
  })
})

// İlk test TypeScript programını kurar; `check`'in paralel yükünde 5 sn'yi aşabiliyor (B1).
describe('ESLint (type-aware)', { timeout: 30_000 }, () => {
  // Bellekteki dosya, projenin tsconfig'ine ait olmadığı için varsayılan projeye alınır.
  const FIXTURES = ['src/main/__guard__.ts', 'src/renderer/core/__guard__.ts']
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: {
      languageOptions: { parserOptions: { projectService: { allowDefaultProject: FIXTURES } } }
    }
  })

  async function rules(code: string, file = FIXTURES[0]!): Promise<(string | null)[]> {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) })
    return result!.messages.map((m) => m.ruleId)
  }

  it('floating promise hata verir', async () => {
    const code =
      'export async function f(): Promise<void> {}\nexport function g(): void {\n  f()\n}\n'
    expect(await rules(code)).toContain('@typescript-eslint/no-floating-promises')
  })

  it('dangerouslySetInnerHTML (React) hata verir', async () => {
    const code = "export const p = { dangerouslySetInnerHTML: { __html: 'x' } }\n"
    expect(await rules(code, FIXTURES[1])).toContain('no-restricted-syntax')
  })

  it('innerHTML (nokta ve köşeli parantez) hata verir', async () => {
    const code =
      "export function f(el: HTMLElement, s: string): void {\n  el.innerHTML = s\n  el['outerHTML'] = s\n}\n"
    const found = await rules(code, FIXTURES[1])
    expect(found).toContain('no-restricted-properties')
    expect(found).toContain('no-restricted-syntax')
  })

  it('new Function ve string ile setTimeout hata verir', async () => {
    const code = "export const f = new Function('return 1')\nsetTimeout('f()', 10)\n"
    expect(await rules(code)).toEqual(
      expect.arrayContaining(['no-new-func', '@typescript-eslint/no-implied-eval'])
    )
  })

  it('platforma özel API main/platform dışında hata verir', async () => {
    const code =
      "import { Tray } from 'electron'\nexport const t = Tray\nexport const p = process.platform\n"
    const found = await rules(code)
    expect(found).toContain('no-restricted-imports')
    expect(found).toContain('no-restricted-properties')
  })

  it('gerekçesiz any hata verir', async () => {
    expect(await rules('export const x: any = 1\n')).toContain('@typescript-eslint/no-explicit-any')
  })
})
