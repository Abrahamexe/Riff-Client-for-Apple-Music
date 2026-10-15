// Production bundle denetimi (PLAN 1.10, Güvenlik kuralı 1). `npm run build` sonunda çalışır;
// dev build'e özel kod yolları (.env / .p8 okuma, dev server URL'si, 1.5 debug taraması) out/
// içinde bulunursa build'i başarısız kılar. Böylece `pack` / `dist` bu kodu asla paketleyemez.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT_DIR = 'out'

// Her işaret yalnızca dev build'e özel bir kod yolunu temsil eder.
const FORBIDDEN = [
  { marker: 'APPLE_PRIVATE_KEY_PATH', why: '.p8 yolunu okuyan DevTokenProvider' },
  { marker: 'importPKCS8', why: '.p8 anahtarını içe aktaran kod' },
  { marker: 'parseEnv', why: '.env ayrıştırma' },
  { marker: 'loadEnvFile', why: '.env yükleme' },
  { marker: "'.env'", why: '.env dosya yolu' },
  { marker: '".env"', why: '.env dosya yolu' },
  { marker: 'ELECTRON_RENDERER_URL', why: 'dev server URL’si (ortam değişkeniyle yönlendirme)' },
  { marker: 'scanForSecret', why: '1.5 şifresiz kopya taraması (dev aracı)' },
  { marker: '--scan-plaintext', why: '1.5 şifresiz kopya taraması (dev aracı)' },
  { marker: '--cpu-sample', why: '1.8b CPU ölçüm aracı (dev aracı)' },
  { marker: 'mountDebugPanel', why: 'P6 debug paneli kodu (yalnızca dev build)' },
  { marker: 'Riff Client — Debug', why: 'P6 debug paneli işaretlemesi (yalnızca dev build)' },
  { marker: 'btn-signout', why: 'P6 debug paneli düğmeleri (yalnızca dev build)' }
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(c?js|mjs|html)$/.test(name)) yield path
  }
}

let problems = 0
let scanned = 0
for (const file of files(OUT_DIR)) {
  scanned++
  const text = readFileSync(file, 'utf8')
  for (const { marker, why } of FORBIDDEN) {
    if (text.includes(marker)) {
      problems++
      console.error(`✖ ${relative('.', file)}: "${marker}" bulundu — ${why}`)
    }
  }
}

if (scanned === 0) {
  console.error(`✖ ${OUT_DIR}/ boş: önce electron-vite build çalıştırılmalı.`)
  process.exit(1)
}
if (problems > 0) {
  console.error(
    `\nProduction bundle'ında dev build'e özel kod var (${problems} bulgu). ` +
      'Paketleme için `npm run build`, geliştirme için `npm run build:dev` kullanın.'
  )
  process.exit(1)
}
console.log(`✔ Production bundle temiz (${scanned} dosya): .env/.p8 okuma yolu yok.`)
