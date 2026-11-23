// Dağıtım build'i (PLAN 4.4, 4.8): `npm run dist:release`. Zorunlu kapılar:
//   1) AM_TOKEN_SERVICE_URL https olmalı (4.1: production developer token servisi)
//   2) EVS_REQUIRED=1: VMP imzası olmadan installer ÜRETİLMEZ (scripts/evs-vmp-sign.cjs, afterSign)
//   3) `npm run build` → production bundle denetimi (.env/.p8 yolu yok)
//   4) electron-builder --win (NSIS); code-signing yapılandırıldıysa önce o, sonra VMP (Windows sırası)
//   5) dist/win-unpacked üzerinde EVS `verify-pkg` (streaming imzası)
// Sürüm notları/kontrol listesi: docs/RELEASE_CHECKLIST.md.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const fail = (msg) => {
  console.error(`\n[release] ✖ ${msg}\n`)
  process.exit(1)
}

const url = process.env.AM_TOKEN_SERVICE_URL ?? ''
let parsed
try {
  parsed = new URL(url)
} catch {
  fail('AM_TOKEN_SERVICE_URL yok veya geçersiz (server/token-service/README.md).')
}
if (parsed.protocol !== 'https:') fail('AM_TOKEN_SERVICE_URL https olmalı.')

const env = { ...process.env, EVS_REQUIRED: '1' }
delete env.EVS_SKIP
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const run = (cmd, args) => {
  console.log(`\n[release] ▶ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} başarısız (kod ${r.status}).`)
}

run(npm, ['run', 'check'])
run(npm, ['run', 'build'])
run(npx, ['electron-builder', '--win'])

const unpacked = join('dist', 'win-unpacked')
if (!existsSync(unpacked)) fail(`${unpacked} yok.`)
run('python', ['-m', 'castlabs_evs.vmp', 'verify-pkg', unpacked])
console.log('\n[release] ✔ Installer hazır: dist/ (EVS imzalı, token servisi:', parsed.host + ')')
