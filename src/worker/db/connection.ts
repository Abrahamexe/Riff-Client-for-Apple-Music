import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CoreError, logError } from '@shared/errors'
import { migrations as defaultMigrations, type Migration } from './migrations'

// SQLite bağlantısı (PLAN 1.7a). Node'un yerleşik `node:sqlite` modülü kullanılır: ECS 44 (Node 24)
// içinde mevcuttur; native derleme/ABI sorunu yoktur ve testler aynı SQLite API'siyle koşar.
// Bağlantı yalnızca worker sürecinde açılır; main asla DB'ye dokunmaz.

export type Db = DatabaseSync

export function openDatabase(
  path: string,
  migrations: readonly Migration[] = defaultMigrations
): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  try {
    // auto_vacuum yeni dosyada tablolardan ve WAL başlığından ÖNCE ayarlanır (docs: pragma.html).
    db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
    ensureIncrementalVacuum(db)
    migrate(db, migrations)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

/**
 * Worker'ın kullandığı açılış (PLAN 2.3): `quick_check` ile bütünlük denetlenir. DB bozuksa,
 * açılamıyorsa veya şeması uygulamanınkinden yeniyse (uygulama geri alınmış) dosya silinip sıfırdan
 * kurulur: DB bir önbellektir (kütüphane, player durumu, arka plan cache'i Apple'dan / kaynaklardan
 * yeniden oluşur). Yeniden kurma da başarısız olursa hata fırlatılır (worker `fatal` bildirir).
 */
export function openDatabaseResilient(
  path: string,
  migrations: readonly Migration[] = defaultMigrations
): Db {
  if (path === ':memory:') return openDatabase(path, migrations)
  let reason: string
  try {
    const db = openDatabase(path, migrations)
    const result = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check
    if (result === 'ok') return db
    db.close()
    reason = 'bütünlük denetimi başarısız (quick_check)'
  } catch (err) {
    reason =
      err instanceof CoreError && err.code === 'DB_SCHEMA_TOO_NEW'
        ? 'şema uygulamanınkinden yeni'
        : `açılamadı (${(err as { code?: string }).code ?? 'bilinmeyen'})`
  }
  // Mesajda dosya yolu YOK (kullanıcı adı içerir; Güvenlik kuralı 10).
  logError('db', new CoreError('DB_RECREATED', `Yerel DB ${reason}; silinip yeniden kuruluyor.`))
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
  return openDatabase(path, migrations)
}

/** `PRAGMA auto_vacuum`: 0 none · 1 full · 2 incremental. */
export function autoVacuumMode(db: Db): number {
  return (db.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum: number }).auto_vacuum
}

/**
 * Silinen cache satırlarının dosyadan gerçekten çıkması için DB `incremental` auto_vacuum modunda
 * olmalıdır (PLAN 3.A8). SQLite dokümanı (pragma.html, lang_vacuum.html): modu "none"dan değiştirmek
 * yalnızca yeni DB'de ya da `PRAGMA auto_vacuum = ...` ardından `VACUUM` ile mümkündür (WAL modunda da
 * auto_vacuum özelliği VACUUM ile değişir); VACUUM transaction içinde çalışmaz, bu yüzden bu bir
 * migration (transaction) DEĞİL, açılışta tek seferlik bir adımdır. Eski sürümlerde oluşturulmuş
 * DB'ler ilk açılışta bir kez dönüştürülür.
 */
function ensureIncrementalVacuum(db: Db): void {
  if (autoVacuumMode(db) === 2) return
  db.exec('PRAGMA auto_vacuum = INCREMENTAL')
  db.exec('VACUUM')
}

/**
 * Serbest kalan sayfaları dosyadan çıkarır: `incremental_vacuum` boş sayfaları atar ve dosyayı
 * kısaltır; `wal_checkpoint(TRUNCATE)` WAL'daki değişiklikleri ana dosyaya işleyip WAL'ı sıfırlar
 * (aksi halde küçülme WAL'da kalır). Bellek içi DB'de zararsızdır.
 */
export function reclaimSpace(db: Db): void {
  db.exec('PRAGMA incremental_vacuum')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

/**
 * Çıkış sonrası (2.7 Y1): `DELETE` silinen içeriği dosyada bırakır (serbest sayfalar, sayfa içi boş
 * bloklar, WAL çerçeveleri; `secure_delete` varsayılan kapalı). `VACUUM` veritabanını yalnızca canlı
 * veriyle yeniden yazar, `wal_checkpoint(TRUNCATE)` WAL'ı sıfırlar: eski kayıtların baytları
 * `library.db`, `-wal` dosyalarında kalmaz (test: işaret dizisi dosyada aranır).
 */
export function wipeFreeSpace(db: Db): void {
  db.exec('VACUUM')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

export function schemaVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

/** Bekleyen geçişleri sırayla, her biri kendi transaction'ında uygular. */
function migrate(db: Db, migrations: readonly Migration[]): void {
  const current = schemaVersion(db)
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (current > latest) {
    // Daha yeni bir sürümün DB'si (uygulama geri alınmış): bilinmeyen şemaya yazılmaz.
    throw new CoreError(
      'DB_SCHEMA_TOO_NEW',
      `DB şema sürümü (${current}) uygulamanınkinden (${latest}) yeni.`
    )
  }
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    transaction(db, () => {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`)
    })
  }
}

/** `fn` hata verirse tüm değişiklikler geri alınır. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
