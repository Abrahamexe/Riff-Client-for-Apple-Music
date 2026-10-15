import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, schemaVersion, type Db } from '../db/connection'
import { BackgroundHttpCache } from './cache'
import { toPlainText } from './text'

const open: Db[] = []
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close()
})
const memoryDb = (): Db => {
  const db = openDatabase(':memory:')
  open.push(db)
  return db
}

describe('BackgroundHttpCache (3.A1, migration 2)', () => {
  it('yazar, okur, günceller; 404 kaydı da saklanır', () => {
    const db = memoryDb()
    expect(schemaVersion(db)).toBeGreaterThanOrEqual(2)
    const cache = new BackgroundHttpCache(db)
    expect(cache.get('k')).toBeNull()
    cache.set('k', 'musicbrainz', { status: 200, body: '{"a":1}', fetchedAt: 10 })
    expect(cache.get('k')).toEqual({ status: 200, body: '{"a":1}', fetchedAt: 10 })
    cache.set('k', 'musicbrainz', { status: 404, body: '', fetchedAt: 20 })
    expect(cache.get('k')).toEqual({ status: 404, body: '', fetchedAt: 20 })
  })

  it('çıkışta tamamen silinir', () => {
    const cache = new BackgroundHttpCache(memoryDb())
    cache.set('d1', 'lrclib', { status: 200, body: '{}', fetchedAt: 1_000 })
    cache.set('m1', 'musicbrainz', { status: 200, body: '{}', fetchedAt: 1_000 })
    cache.clear()
    expect(cache.get('d1')).toBeNull()
    expect(cache.get('m1')).toBeNull()
  })
})

describe('toPlainText', () => {
  it('etiketleri ve betikleri atar, varlıkları çözer, boşluğu toparlar', () => {
    expect(toPlainText('<p>Merhaba <b>dünya</b></p><script>alert(1)</script>')).toBe(
      'Merhaba dünya'
    )
    expect(toPlainText('Tom &amp; Jerry &#39;99&#x27; &lt;b&gt;')).toBe("Tom & Jerry '99' <b>")
    expect(toPlainText('a\u0000b\u0007c   d\n\n\n\ne')).toBe('abc d\n\ne')
  })

  it('çözülen < > yeniden ayrıştırılmaz; uzun metin kesilir', () => {
    expect(toPlainText('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>')
    expect(toPlainText('x'.repeat(50), 10)).toHaveLength(10)
  })
})
