// Gizli bilgi taraması (PLAN 2.4): git'in takip ettiği + yeni (ignore edilmeyen) dosyalarda sızmış
// anahtar/token arar. Bağımlılık yok (gitleaks yerine). Bulgu varsa çıkış kodu 1; bulunan DEĞER
// yazdırılmaz, yalnızca dosya:satır ve kural adı. `npm run check` ve sürüm kontrol listesinde çalışır.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RULES = [
  // Gerçek PKCS#8 gövdesi (testlerdeki sahte "-----BEGIN PRIVATE KEY-----\nGIZLI" eşleşmez).
  ['özel anahtar', /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{100,}/],
  // Gerçek ES256 imzası 86 karakterdir; testlerdeki kısa sahte imzalar eşleşmez.
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{80,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  // Örnek değerler (ABC123DEFG, KEY1234567; E2E: E2ETEAM001, E2EKEY0001) testlerde kullanılır.
  [
    'Apple Team/Key ID ataması',
    /APPLE_(?:TEAM|KEY)_ID\s*=\s*["']?(?!ABC123DEFG|KEY1234567|E2ETEAM001|E2EKEY0001)[A-Z0-9]{10}\b/
  ],
  [
    'opsiyonel kaynak key ataması',
    /\b(?:DISCOGS_TOKEN|LASTFM_API_KEY)\s*=\s*["']?[A-Za-z0-9]{16,}/
  ],
  ['.p8 yolu (gerçek key adı)', /AuthKey_(?!X{6})[A-Z0-9]{10}\.p8/]
]
const FORBIDDEN_FILES = [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, /\.p8$/, /\.pem$/, /(^|\/)secrets\//]

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
const files = [
  ...new Set([...git('ls-files'), ...git('ls-files', '--others', '--exclude-standard')])
]

const findings = []
for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) {
    findings.push(`${file}: takip edilmemesi gereken dosya`)
    continue
  }
  if (/package-lock\.json$|\.(png|ico|jpg|zip|exe|db)$/.test(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // silinmiş / okunamayan
  }
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) findings.push(`${file}:${i + 1}: ${name}`)
  })
  // Çok satırlı özel anahtar.
  if (RULES[0][1].test(text) && !findings.some((f) => f.startsWith(file))) {
    findings.push(`${file}: özel anahtar`)
  }
}

if (findings.length > 0) {
  console.error(`[scan-secrets] ${findings.length} olası gizli bilgi (değerler yazdırılmadı):`)
  for (const f of findings) console.error(`  ✖ ${f}`)
  process.exit(1)
}
console.log(`[scan-secrets] ✔ ${files.length} dosya tarandı, gizli bilgi bulunmadı.`)
