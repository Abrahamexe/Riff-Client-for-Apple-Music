// electron-builder `afterSign` hook'u: paketlenmiş uygulamayı castlabs EVS ile VMP-imzalar (PLAN 1.10).
//
// SIRA (castlabs EVS wiki): Windows'ta VMP imzası code-signing'den SONRA yapılmalıdır, yoksa bozulur.
// (macOS'ta tersi: VMP önce.) electron-builder `afterSign`'ı code-signing'den sonra çağırır.
//
// Davranış:
//   - EVS kullanılabilir ve hesap hazırsa: `sign-pkg <appOutDir>` çalıştırılır, ardından `verify-pkg`.
//   - EVS yoksa/başarısızsa: EVS_REQUIRED=1 ise build BAŞARISIZ olur; aksi halde yüksek sesli uyarıyla
//     devam edilir (installer yalnızca "development only" imzalı olur ve Apple Music'i çalmayabilir).
//   - EVS_SKIP=1: imzalama hiç denenmez (yalnızca geliştirme amaçlı yerel build'ler için).
//
// Hesap parolası bu script tarafından okunmaz/loglanmaz; EVS istemcisinin kendi önbelleğini kullanır.

const { spawnSync } = require('node:child_process')

function findPython() {
  for (const [cmd, ...pre] of [['python'], ['py', '-3'], ['python3']]) {
    if (spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8' }).status === 0)
      return { cmd, pre }
  }
  return null
}

function warnOrFail(message) {
  if (process.env.EVS_REQUIRED === '1') throw new Error(`[evs-vmp-sign] ${message}`)
  console.warn('\n' + '!'.repeat(78))
  console.warn(`[evs-vmp-sign] UYARI: ${message}`)
  console.warn(
    '[evs-vmp-sign] Bu paket "development only" VMP imzalıdır; Apple Music çalmayabilir.'
  )
  console.warn('[evs-vmp-sign] Üretim için EVS_REQUIRED=1 ile build alın.')
  console.warn('!'.repeat(78) + '\n')
}

exports.default = async function evsVmpSign(context) {
  if (context.electronPlatformName !== 'win32') return
  if (process.env.EVS_SKIP === '1') {
    return warnOrFail('EVS_SKIP=1: VMP imzalama atlandı.')
  }

  const python = findPython()
  if (!python) return warnOrFail('Python bulunamadı.')
  if (
    spawnSync(python.cmd, [...python.pre, '-c', 'import castlabs_evs'], { encoding: 'utf8' })
      .status !== 0
  ) {
    return warnOrFail('castlabs-evs kurulu değil (python -m pip install --upgrade castlabs-evs).')
  }

  const run = (args) =>
    spawnSync(python.cmd, [...python.pre, '-m', 'castlabs_evs.vmp', '--no-ask', ...args], {
      stdio: 'inherit'
    })

  console.log(`[evs-vmp-sign] VMP imzalanıyor (code-signing sonrası): ${context.appOutDir}`)
  if (run(['sign-pkg', context.appOutDir]).status !== 0) {
    return warnOrFail('EVS imzalama başarısız (hesap/signup, parola veya ağ).')
  }
  if (run(['verify-pkg', context.appOutDir]).status !== 0) {
    return warnOrFail('İmza doğrulaması başarısız.')
  }
}
