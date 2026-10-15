// Geliştirme ECS binary'sini castlabs EVS ile VMP-imzalar (Adım 1.6).
//
// Neden: `npm install` ile inen hazır ECS binary'si yalnızca "development only" imzalıdır
// (`vmp verify-pkg` → "Certificate is valid for development only"). Apple Music bunu kabul
// etmeyip 30 sn önizlemeye düşebilir veya hiç çalmayabilir. EVS imzası bunu üretim imzasıyla değiştirir.
//
// Kullanım:
//   node scripts/evs-sign-dev.mjs --verify [dizin]   # yalnızca imza durumunu göster (hesap gerekmez)
//   node scripts/evs-sign-dev.mjs [dizin]            # imzala (EVS hesabı gerekir, etkileşimlidir)
//
// Varsayılan dizin: node_modules/electron/dist  (içinde electron.exe olan klasör; .exe'nin kendisi değil)
// Kaynak: castlabs/electron-releases wiki → EVS. Windows'ta VMP imzası code-signing'den SONRA yapılır;
// geliştirme binary'si code-signed olmadığı için burada ek adım yoktur (bkz. Adım 1.10 hook'u).
//
// Not: `npm install`/`npm ci` node_modules/electron/dist'i yeniden indirirse imza kaybolur; scripti tekrar çalıştırın.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const verifyOnly = args.includes('--verify')
const dirArg = args.find((a) => !a.startsWith('--'))
const distDir = resolve(dirArg ?? join('node_modules', 'electron', 'dist'))

function fail(message) {
  console.error(`\n[evs-sign-dev] ${message}\n`)
  process.exit(1)
}

// Python'u bul: python, py -3, python3 (ilk çalışan).
function findPython() {
  const candidates = [['python'], ['py', '-3'], ['python3']]
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8' })
    if (r.status === 0) return { cmd, pre }
  }
  return null
}

if (!existsSync(join(distDir, 'electron.exe'))) {
  fail(
    `electron.exe bulunamadı: ${distDir}\n` +
      "Önce ECS binary'sini indirin:  node node_modules/electron/install.js"
  )
}

const python = findPython()
if (!python) fail('Python bulunamadı. Python 3 kurun (https://www.python.org/downloads/).')

const runPy = (pyArgs, opts = {}) =>
  spawnSync(python.cmd, [...python.pre, ...pyArgs], { stdio: 'inherit', ...opts })

const hasEvs = spawnSync(python.cmd, [...python.pre, '-c', 'import castlabs_evs'], {
  encoding: 'utf8'
})
if (hasEvs.status !== 0) {
  fail(
    'castlabs-evs kurulu değil. Kurun:\n' +
      `  ${python.cmd} ${[...python.pre, '-m', 'pip', 'install', '--upgrade', 'castlabs-evs'].join(' ')}\n` +
      'Hesabınız yoksa (bir kez, etkileşimli):\n' +
      `  ${python.cmd} ${[...python.pre, '-m', 'castlabs_evs.account', 'signup'].join(' ')}`
  )
}

if (verifyOnly) {
  console.log(`[evs-sign-dev] İmza doğrulanıyor: ${distDir}`)
  const r = runPy(['-m', 'castlabs_evs.vmp', '--no-ask', 'verify-pkg', distDir])
  process.exit(r.status ?? 1)
}

console.log(`[evs-sign-dev] İmzalanıyor: ${distDir}`)
console.log(
  '[evs-sign-dev] EVS hesap adı/parolası istenebilir (parola bu script tarafından saklanmaz/loglanmaz).'
)
const r = runPy(['-m', 'castlabs_evs.vmp', 'sign-pkg', distDir])
if (r.status !== 0)
  fail('İmzalama başarısız. EVS hesabınızı (signup/confirm) ve internet bağlantısını kontrol edin.')

console.log('[evs-sign-dev] Tamam. Doğrulama:  npm run evs:verify')
