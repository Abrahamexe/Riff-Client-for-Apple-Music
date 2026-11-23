import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db/connection'
import { BackgroundHttpCache } from './cache'
import { CacheMaintenance, MATCH_RETAIN_MS, TRACK_RETAIN_MS } from './cacheMaintenance'
import { SOURCE_POLICIES } from './sources/policies'

// Cache boyut yönetimi (PLAN 3.A8): LRU silme, süresi dolanlar, tetikleyiciler ve dosyanın gerçekten
// küçülmesi. Gerçek dosya DB'si kullanılır (dosya boyutu :memory:'de ölçülemez).

let dir: string
let path: string
let db: Db
let clock = 1_700_000_000_000
const now = (): number => clock

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-cache-'))
  path = join(dir, 'am.db')
  db = openDatabase(path)
  clock = 1_700_000_000_000
})
afterEach(async () => {
  if (db.isOpen) db.close()
  await rm(dir, { recursive: true, force: true })
})

const BODY = 8_000
const count = (table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const has = (key: string): boolean =>
  db.prepare('SELECT 1 FROM bg_http_cache WHERE key = ?').get(key) !== undefined
/** Ana dosyayı güncel hale getirir (WAL'ı işler ve sıfırlar) ve dosya boyutunu verir. */
function fileSize(): number {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return statSync(path).size
}
const config = (over: Partial<ConstructorParameters<typeof CacheMaintenance>[1]> = {}) => ({
  maxBytes: 1_000_000,
  lowWaterRatio: 0.9,
  sweepEveryWrites: 1_000_000,
  now,
  ...over
})

function fill(cache: BackgroundHttpCache, rows: number, source = 'musicbrainz'): void {
  for (let i = 0; i < rows; i++) {
    clock += 1_000
    cache.set(`k${i}`, source, {
      status: 200,
      body: `${i}`.padEnd(BODY, 'x'),
      fetchedAt: clock
    })
  }
}

describe('CacheMaintenance (3.A8)', () => {
  it('sınırın üzerinde doldurulan cache sınırın altına iner; son erişilenler korunur; dosya küçülür', () => {
    const cache = new BackgroundHttpCache(db, { now })
    fill(cache, 300) // ≈ 2,4 MB
    clock += 100_000
    cache.get('k0') // en eski iki satır yeniden erişildi → korunmalı
    cache.get('k1')
    const maintenance = new CacheMaintenance(db, config())
    const before = maintenance.totalBytes()
    expect(before).toBeGreaterThan(2_000_000)
    const sizeBefore = fileSize()
    expect(sizeBefore).toBeGreaterThan(2_000_000)

    const result = maintenance.sweep()

    expect(result.bytesBefore).toBe(before)
    expect(maintenance.totalBytes()).toBeLessThanOrEqual(900_000) // sınırın %90'ı
    expect(result.evicted).toBeGreaterThan(150)
    expect(has('k0')).toBe(true)
    expect(has('k1')).toBe(true)
    expect(has('k299')).toBe(true) // en son yazılan
    expect(has('k2')).toBe(false) // en uzun süredir erişilmeyen
    expect(has('k3')).toBe(false)
    // Dosya diskte gerçekten küçüldü (auto_vacuum=incremental + incremental_vacuum + checkpoint).
    const sizeAfter = statSync(path).size
    expect(sizeAfter).toBeLessThan(sizeBefore * 0.5)
    expect(existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0).toBe(0)
  })

  it('sınırın altındaysa hiçbir şey silinmez ve dosyaya dokunulmaz', () => {
    const cache = new BackgroundHttpCache(db, { now })
    fill(cache, 20)
    const maintenance = new CacheMaintenance(db, config())
    expect(maintenance.sweep()).toMatchObject({ expired: 0, evicted: 0 })
    expect(count('bg_http_cache')).toBe(20)
  })

  it('süresi dolanlar sınır aşılmasa da silinir (kaynak, eşleşme ve birleşik sonuç)', () => {
    const cache = new BackgroundHttpCache(db, { now })
    const day = 86_400_000
    const put = (key: string, source: string, ageMs: number): void =>
      cache.set(key, source, { status: 200, body: '{}', fetchedAt: clock - ageMs })
    put('mb-eski', 'musicbrainz', SOURCE_POLICIES.musicbrainz.retainMs + day)
    put('mb-taze', 'musicbrainz', SOURCE_POLICIES.musicbrainz.retainMs - day)
    put('wm-eski', 'wikimedia', SOURCE_POLICIES.wikimedia.retainMs + day)
    put('lr-eski', 'lrclib', SOURCE_POLICIES.lrclib.retainMs + day)
    put('lr-taze', 'lrclib', day)
    const insert = (sql: string, ...p: (string | number)[]): void => void db.prepare(sql).run(...p)
    insert(
      'INSERT INTO bg_match VALUES (?, ?, ?, ?, ?)',
      'm-eski',
      '{}',
      clock - MATCH_RETAIN_MS - day,
      10,
      clock
    )
    insert('INSERT INTO bg_match VALUES (?, ?, ?, ?, ?)', 'm-taze', '{}', clock - day, 10, clock)
    insert(
      'INSERT INTO bg_track VALUES (?, ?, ?, ?, ?, ?)',
      't-eski',
      'en',
      '{}',
      clock - TRACK_RETAIN_MS - day,
      10,
      clock
    )
    insert(
      'INSERT INTO bg_track VALUES (?, ?, ?, ?, ?, ?)',
      't-taze',
      'en',
      '{}',
      clock - day,
      10,
      clock
    )

    const result = new CacheMaintenance(db, config()).sweep()

    expect(result).toMatchObject({ expired: 5, evicted: 0 })
    expect(has('mb-eski') || has('wm-eski') || has('lr-eski')).toBe(false)
    expect(has('mb-taze') && has('lr-taze')).toBe(true)
    expect(count('bg_match')).toBe(1)
    expect(count('bg_track')).toBe(1)
  })

  it('temizlik periyodik değil, yazım sayısıyla tetiklenir', () => {
    const maintenance = new CacheMaintenance(db, config({ maxBytes: 100_000, sweepEveryWrites: 5 }))
    const cache = new BackgroundHttpCache(db, { now, onWrite: () => maintenance.noteWrite() })
    fill(cache, 4) // 4 yazım: sınır (100 KB) henüz aşılmadı, temizlik tetiklenmez
    expect(count('bg_http_cache')).toBe(4)
    fill(cache, 20) // her 5 yazımda bir temizlik çalışır (5., 10., 15., 20.)
    // Son temizlikten sonra en fazla 4 yazım birikebilir: aşım bununla sınırlıdır.
    expect(maintenance.totalBytes()).toBeLessThanOrEqual(100_000 + 4 * (BODY + 10))
    expect(count('bg_http_cache')).toBeLessThan(20)
  })

  it('yazım sayacı temizlikten sonra sıfırlanır: her yazımda değil, her N yazımda çalışır', () => {
    const maintenance = new CacheMaintenance(
      db,
      config({ maxBytes: 1_000_000, sweepEveryWrites: 10 })
    )
    let sweeps = 0
    const original = maintenance.sweep.bind(maintenance)
    maintenance.sweep = () => (sweeps++, original())
    for (let i = 0; i < 35; i++) maintenance.noteWrite()
    expect(sweeps).toBe(3)
  })

  it('temizlik hatası yazımı bozmaz', () => {
    const maintenance = new CacheMaintenance(db, config({ sweepEveryWrites: 1 }))
    db.close()
    expect(() => maintenance.noteWrite()).not.toThrow()
  })

  it('tüm cache silindikten sonra (çıkış) reclaim dosyayı küçültür', () => {
    const cache = new BackgroundHttpCache(db, { now })
    fill(cache, 200)
    const sizeBefore = fileSize()
    cache.clear()
    new CacheMaintenance(db, config()).reclaim()
    expect(statSync(path).size).toBeLessThan(sizeBefore * 0.2)
  })

  it('geçersiz ayarlar reddedilir', () => {
    expect(() => new CacheMaintenance(db, config({ maxBytes: 0 }))).toThrow(RangeError)
    expect(() => new CacheMaintenance(db, config({ lowWaterRatio: 1.5 }))).toThrow(RangeError)
  })
})
