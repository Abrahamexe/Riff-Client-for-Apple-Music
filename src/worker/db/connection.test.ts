import { statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autoVacuumMode,
  openDatabase,
  openDatabaseResilient,
  reclaimSpace,
  schemaVersion,
  transaction,
  type Db
} from './connection'
import { migrations } from './migrations'

let dir: string
const open: Db[] = []
const track = (db: Db): Db => (open.push(db), db)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-db-'))
})
afterEach(async () => {
  for (const db of open.splice(0)) if (db.isOpen) db.close()
  await rm(dir, { recursive: true, force: true })
})

const tables = (db: Db): string[] =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string
    }[]
  ).map((r) => r.name)

describe('openDatabase', () => {
  it('WAL modunda açar, klasörü oluşturur ve tüm tabloları kurar', () => {
    const db = track(openDatabase(join(dir, 'alt', 'library.db')))
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(mode.journal_mode).toBe('wal')
    expect(schemaVersion(db)).toBe(migrations.at(-1)!.version)
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'playlists',
        'tracks',
        'playlist_tracks',
        'artwork',
        'player_state',
        'sync_meta'
      ])
    )
    const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(fk.foreign_keys).toBe(1)
  })

  it('yeniden açılışta geçişleri tekrar uygulamaz, veri korunur', () => {
    const path = join(dir, 'library.db')
    const first = track(openDatabase(path))
    first.prepare("INSERT INTO sync_meta VALUES ('x', 1, 'h', 0)").run()
    first.close()
    const second = track(openDatabase(path))
    expect(second.prepare('SELECT COUNT(*) AS n FROM sync_meta').get()).toEqual({ n: 1 })
  })

  it('yeni geçişleri sırayla ve transaction içinde uygular; hatalı geçiş geri alınır', () => {
    const path = join(dir, 'library.db')
    track(openDatabase(path, [{ version: 1, sql: 'CREATE TABLE a (x INTEGER)' }])).close()
    expect(() =>
      openDatabase(path, [
        { version: 1, sql: 'CREATE TABLE a (x INTEGER)' },
        { version: 2, sql: 'CREATE TABLE b (y INTEGER); SELECT * FROM yok' }
      ])
    ).toThrow()
    const db = track(openDatabase(path, [{ version: 1, sql: 'CREATE TABLE a (x INTEGER)' }]))
    expect(schemaVersion(db)).toBe(1)
    expect(tables(db)).not.toContain('b')
  })

  it('uygulamadan yeni şema sürümünü reddeder', () => {
    const path = join(dir, 'library.db')
    const db = track(openDatabase(path))
    db.exec('PRAGMA user_version = 999')
    db.close()
    expect(() => openDatabase(path)).toThrow(/yeni/)
  })
})

describe('transaction', () => {
  it('hata olursa tüm yazımları geri alır', () => {
    const db = track(openDatabase(':memory:'))
    expect(() =>
      transaction(db, () => {
        db.prepare("INSERT INTO sync_meta VALUES ('a', 1, 'h', 0)").run()
        throw new Error('iptal')
      })
    ).toThrow('iptal')
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_meta').get()).toEqual({ n: 0 })
  })
})

describe('auto_vacuum (3.A8)', () => {
  it('yeni DB incremental auto_vacuum modunda açılır (tablolardan ve WAL başlığından önce)', () => {
    const db = track(openDatabase(join(dir, 'yeni.db')))
    expect(autoVacuumMode(db)).toBe(2)
  })

  it('eski (auto_vacuum=none) DB açılışta bir kez dönüştürülür; veri korunur', () => {
    const path = join(dir, 'eski.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE eski (x TEXT); INSERT INTO eski VALUES ('korunur')"
    )
    expect(autoVacuumMode(legacy)).toBe(0)
    legacy.close()

    const db = track(openDatabase(path))
    expect(autoVacuumMode(db)).toBe(2)
    expect(db.prepare('SELECT x FROM eski').get()).toEqual({ x: 'korunur' })
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe(
      'wal'
    )
    // İkinci açılış yeniden dönüştürmez.
    db.close()
    expect(autoVacuumMode(track(openDatabase(path)))).toBe(2)
  })

  it('silinen satırlar dosyadan ancak reclaimSpace ile çıkar; WAL de sıfırlanır', () => {
    const path = join(dir, 'boyut.db')
    const db = track(openDatabase(path))
    db.exec('CREATE TABLE blob_test (id INTEGER PRIMARY KEY, v TEXT)')
    const insert = db.prepare('INSERT INTO blob_test (v) VALUES (?)')
    for (let i = 0; i < 500; i++) insert.run('x'.repeat(8_000))
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const full = statSync(path).size
    expect(full).toBeGreaterThan(3_000_000)

    db.exec('DELETE FROM blob_test')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    expect(statSync(path).size).toBeGreaterThan(full * 0.9) // silmek tek başına küçültmez

    reclaimSpace(db)
    expect(statSync(path).size).toBeLessThan(full * 0.1)
    expect(statSync(`${path}-wal`).size).toBe(0)
  })

  it('bellek içi DB’de reclaimSpace zararsızdır', () => {
    const db = track(openDatabase(':memory:'))
    expect(() => reclaimSpace(db)).not.toThrow()
  })
})

describe('openDatabaseResilient (2.3: bozuk DB silinip yeniden kurulur)', () => {
  it.each([
    [
      'bozuk dosya (SQLite değil)',
      (p: string) => writeFileSync(p, 'bu bir veritabanı değil'.repeat(500))
    ],
    [
      'şeması uygulamanınkinden yeni',
      (p: string) => {
        const db = new DatabaseSync(p)
        db.exec('PRAGMA user_version = 999')
        db.close()
      }
    ]
  ])('%s → yeniden kurulur, kodla loglanır, yol loglanmaz', (_l, prepare) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const path = join(dir, 'library.db')
    prepare(path)
    const db = track(openDatabaseResilient(path))
    expect(schemaVersion(db)).toBe(migrations.at(-1)!.version)
    expect(tables(db)).toContain('playlists')
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('DB_003')
    expect(logged).not.toContain(dir)
    warn.mockRestore()
  })

  it('sağlam DB’ye dokunmaz (veri korunur)', () => {
    const path = join(dir, 'library.db')
    const first = openDatabase(path)
    first.exec(
      "INSERT INTO sync_meta (scope, synced_at, content_hash, item_count) VALUES ('k', 1, 'h', 0)"
    )
    first.close()
    const db = track(openDatabaseResilient(path))
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_meta').get()).toEqual({ n: 1 })
  })
})
