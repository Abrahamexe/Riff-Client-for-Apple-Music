// Açık kaynak lisans bildirimleri (PLAN_v5 A2). Bundle'a gömülen üretim bağımlılıklarının
// (`package.json` → dependencies ve onların geçişli dependencies'i) lisans metinlerini tek dosyada
// toplar: `build/THIRD_PARTY_NOTICES.txt`. electron-builder `extraFiles` ile kurulum klasörüne
// kopyalar. Electron/Chromium bildirimleri (LICENSE.electron.txt, LICENSES.chromium.html) ECS
// binary'siyle zaten gelir. Lisans dosyası bulunamayan paket → çıkış kodu 1 (MIT vb. dağıtımda telif
// bildirimini şart koşar; sessizce atlanmaz).
//
// Kullanım: node scripts/third-party-notices.mjs [--root <dizin>] [--out <dosya>]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const root = resolve(arg('--root', '.'))
const out = resolve(root, arg('--out', 'build/THIRD_PARTY_NOTICES.txt'))

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// Node çözümleme sırası: önce isteyen paketin kendi node_modules'u, sonra kökteki.
function packageDir(name, fromDir) {
  for (const base of [join(fromDir, 'node_modules'), join(root, 'node_modules')]) {
    const dir = join(base, name)
    if (existsSync(join(dir, 'package.json'))) return dir
  }
  return undefined
}

function licenseText(dir) {
  const file = readdirSync(dir).find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : undefined
}

const rootPkg = readJson(join(root, 'package.json'))
const queue = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({ name, from: root }))
const seen = new Map()
const errors = []

while (queue.length > 0) {
  const { name, from } = queue.shift()
  const dir = packageDir(name, from)
  if (!dir) {
    errors.push(`${name}: node_modules'ta bulunamadı`)
    continue
  }
  if (seen.has(dir)) continue
  const pkg = readJson(join(dir, 'package.json'))
  const text = licenseText(dir)
  if (!text) errors.push(`${name}@${pkg.version}: lisans dosyası yok`)
  seen.set(dir, { name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', text })
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir })
}

if (errors.length > 0) {
  console.error('[third-party-notices] eksik lisans:')
  for (const e of errors) console.error(`  ✖ ${e}`)
  process.exit(1)
}

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const sep = '='.repeat(78)
const body = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  'This application includes the following open source software. Electron and Chromium notices',
  'are provided separately in LICENSE.electron.txt and LICENSES.chromium.html.',
  '',
  ...entries.flatMap((e) => [sep, `${e.name} ${e.version} (${e.license})`, sep, '', e.text, ''])
].join('\n')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, body, 'utf8')
console.log(
  `[third-party-notices] ✔ ${entries.length} paket → ${out} (${entries.map((e) => e.name).join(', ')})`
)
