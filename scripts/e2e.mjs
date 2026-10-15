// E2E runner (PLAN 2.6): `npm run e2e` (önce build:dev). Her senaryo ayrı bir Electron sürecinde,
// geçici bir profille çalışır (tests/e2e/harness.cjs); sonuçlar doğrulanır. Ağa, Apple'a ve
// geliştiricinin .env/.p8/oturumuna dokunulmaz. Açılış bütçesi aşılırsa test başarısız olur.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const HARNESS = join(ROOT, 'tests', 'e2e', 'harness.cjs')
// PLAN 2.1 bütçeleri (sıcak açılış) + ölçüm gürültüsü payı. Ortam değişkeniyle sıkılaştırılabilir.
const BUDGET = {
  windowShownMs: Number(process.env.E2E_BUDGET_WINDOW_MS ?? 800),
  libraryVisibleMs: Number(process.env.E2E_BUDGET_LIBRARY_MS ?? 1500)
}

if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('[e2e] out/ yok: önce `npm run build:dev`.')
  process.exit(1)
}

function run(scenario, dir, timeoutMs = 60_000) {
  return new Promise((resolveRun) => {
    const child = spawn(ELECTRON, [HARNESS], {
      env: { ...process.env, E2E_SCENARIO: scenario, E2E_DIR: dir, ELECTRON_ENABLE_LOGGING: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      const line = out.split('\n').find((l) => l.startsWith('E2E_RESULT '))
      resolveRun({ code, result: line ? JSON.parse(line.slice(11)) : null, out })
    })
  })
}

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail })
const fresh = () => mkdtempSync(join(tmpdir(), 'am-e2e-'))

async function main() {
  const dirs = []
  try {
    // 1) Açılış + bütçe. P7: derlemeden hemen sonraki İLK açılış soğuktur (işletim sistemi dosya
    // önbelleği; ölçüldü: appReady ~950 ms, ısınmışta ~100 ms — uygulama kodundan önce). Önce bir
    // ısınma açılışı yapılır ve soğuk süreler yalnızca BİLGİ olarak basılır; bütçe ısınmış açılışa
    // uygulanır (kullanıcının günlük açılışı da ısınmıştır; soğuk açılış PERFORMANCE.md'de ayrıca).
    let d = fresh()
    dirs.push(d)
    const { result: cold } = await run('startup', d)
    console.log(
      `ℹ açılış (soğuk, bilgi): pencere ${cold?.windowShown ?? '—'} ms, kütüphane ${cold?.libraryVisible ?? '—'} ms, appReady ${cold?.appReady ?? '—'} ms`
    )
    d = fresh()
    dirs.push(d)
    let { result: r } = await run('startup', d)
    check('açılış: sonuç', r && !r.error, r?.error)
    if (r) {
      check(
        `açılış: pencere görünür < ${BUDGET.windowShownMs} ms`,
        r.windowShown < BUDGET.windowShownMs,
        `${r.windowShown} ms`
      )
      check(
        `açılış: kütüphane görünür < ${BUDGET.libraryVisibleMs} ms`,
        r.libraryVisible < BUDGET.libraryVisibleMs,
        `${r.libraryVisible} ms`
      )
      check('açılış: MusicKit (sahte) yapılandırıldı', r.musicKitReady > 0, `${r.musicKitReady} ms`)
    }

    // 2) player-hub
    d = fresh()
    dirs.push(d)
    ;({ result: r } = await run('hub', d, 120_000))
    check(
      'player-hub: yardımcı pencereden komut',
      r?.commandResult === 'ok',
      r?.error ?? r?.commandResult
    )
    check('player-hub: durum yayını (playing)', r?.auxState === 'playing')
    check('player-hub: sonraki → sıra 1', r?.auxPosition === 1)

    // 3) Çökme toparlanması
    d = fresh()
    dirs.push(d)
    ;({ result: r } = await run('crash', d, 90_000))
    check(
      'çökme: worker ölürken istek hızlı hata',
      r?.readDuringWorkerCrash === 'WORKER_UNAVAILABLE' || r?.readDuringWorkerCrash === 'ok',
      r?.readDuringWorkerCrash
    )
    check(
      'çökme: worker yeniden başladı',
      r?.workerRestarted && r?.readAfterWorkerRestart === 'ok',
      r?.error
    )
    check('çökme: renderer toparlandı', r?.rendererRecovered && r?.readAfterRendererCrash === 'ok')

    // 4) Kabuk tıklamaları (hamburger ve arama sürükleme şeridinin altında kalmaz)
    d = fresh()
    dirs.push(d)
    ;({ result: r } = await run('shell', d))
    check(
      'kabuk: hamburger ve arama tıklanabilir',
      r?.toggleHit === true && r?.searchHit === true,
      r?.error ?? `${r?.toggleHit}/${r?.searchHit}`
    )
    check(
      // 2026-10-15: uygulama menü kapalı açılır; ilk tık açar, ikincisi kapatır.
      'kabuk: menü kapalı açılır, hamburger açar ve kapatır',
      r?.menuBefore === 'false' && r?.menuAfterClose === 'true' && r?.menuAfterOpen === 'false',
      `${r?.menuBefore}→${r?.menuAfterClose}→${r?.menuAfterOpen}`
    )

    // 5) X = çık
    d = fresh()
    dirs.push(d)
    ;({ result: r } = await run('quit', d))
    check('X: uygulamadan çıkar', r?.willQuit === true && !r?.stillRunning, JSON.stringify(r))

    // 6) Tek örnek
    d = fresh()
    dirs.push(d)
    const first = run('hold', d)
    const flag = join(d, 'ready.flag')
    const start = Date.now()
    while (!existsSync(flag) && Date.now() - start < 30_000)
      await new Promise((x) => setTimeout(x, 100))
    const second = await run('startup', d, 20_000)
    const firstRes = await first
    check(
      'tek örnek: ikinci açılış pencere açmadan çıkar',
      second.code === 0 && !second.result?.windowCreated,
      `kod ${second.code}`
    )
    check(
      'tek örnek: birinci pencere öne gelir',
      firstRes.result?.secondInstanceSeen && firstRes.result?.mainVisible
    )
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  }

  for (const c of checks)
    console.log(`${c.ok ? '✔' : '✖'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
  const failed = checks.filter((c) => !c.ok)
  console.log(`[e2e] ${checks.length - failed.length}/${checks.length} geçti`)
  process.exit(failed.length > 0 ? 1 : 0)
}

void main()
