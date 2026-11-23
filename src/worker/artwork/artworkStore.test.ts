import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkStore } from './artworkStore'

// Ağ yok: fetch enjekte edilir.
const SRC = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/x.jpg/512x512bb.jpg'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-art-w-'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const image = (bytes = 1_000, type = 'image/jpeg') =>
  new Response(new Uint8Array(bytes).fill(7), { status: 200, headers: { 'content-type': type } })

describe('ArtworkStore (2.2, A3.2: worker)', () => {
  it('indirir ve diske yazar; dosya varsa yeniden indirmez', async () => {
    const fetch = vi.fn(async () => image())
    const store = new ArtworkStore({ dir, maxBytes: 1e9, fetch })
    expect(await store.fetch(SRC)).toBe('ok')
    const files = await readdir(dir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.jpg$/)
    expect((await stat(join(dir, files[0]!))).size).toBe(1_000)
    expect(await new ArtworkStore({ dir, maxBytes: 1e9, fetch }).fetch(SRC)).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('aynı anda gelen aynı görsel tek indirme', async () => {
    const fetch = vi.fn(async () => image())
    const store = new ArtworkStore({ dir, maxBytes: 1e9, fetch })
    expect(await Promise.all([store.fetch(SRC), store.fetch(SRC)])).toEqual(['ok', 'ok'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('yönlendirme izlenmez (P8, F2): istek redirect manual; 3xx → failed', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })
    )
    const store = new ArtworkStore({ dir, maxBytes: 1e9, fetch })
    expect(await store.fetch(SRC)).toBe('failed')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
    expect(await readdir(dir)).toEqual([])
  })

  it('geçersiz kaynak → invalid, ağa çıkılmaz', async () => {
    const fetch = vi.fn(async () => image())
    const store = new ArtworkStore({ dir, maxBytes: 1e9, fetch })
    expect(await store.fetch('https://evil.com/x.jpg')).toBe('invalid')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP hatası', () => new Response('', { status: 404 })],
    ['görsel olmayan yanıt', () => image(10, 'text/html')],
    ['aşırı büyük', () => image(3 * 1024 * 1024)],
    ['boş gövde', () => image(0)],
    [
      'bildirilen boyut aşırı (gövde okunmaz)',
      () =>
        new Response(new Uint8Array(10), {
          headers: { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) }
        })
    ],
    ['ağ hatası', () => Promise.reject(new Error('ağ yok'))]
  ])('%s → failed, diske yazılmaz', async (_l, reply) => {
    const store = new ArtworkStore({ dir, maxBytes: 1e9, fetch: vi.fn(async () => reply()) })
    expect(await store.fetch(SRC)).toBe('failed')
    expect(await readdir(dir)).toEqual([])
  })

  it('yazılamazsa failed (yol loglanmaz)', async () => {
    const blocker = join(dir, 'dosya')
    await writeFile(blocker, 'x') // klasör yerine dosya: mkdir başarısız
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new ArtworkStore({ dir: blocker, maxBytes: 1e9, fetch: async () => image() })
    expect(await store.fetch(SRC)).toBe('failed')
    expect(JSON.stringify(error.mock.calls)).not.toContain(dir)
  })

  it('boyut sınırı: en uzun süredir erişilmeyenler silinir, yarım geçici dosyalar temizlenir', async () => {
    for (let i = 0; i < 5; i++) {
      const f = join(dir, `${i}.jpg`)
      await writeFile(f, new Uint8Array(100))
      const t = new Date(1_700_000_000_000 + i * 1000)
      await utimes(f, t, t)
    }
    await writeFile(join(dir, 'yarim.jpg.123.tmp'), new Uint8Array(10))
    const store = new ArtworkStore({ dir, maxBytes: 300, lowWaterRatio: 0.7, fetch: vi.fn() })
    await store.sweep()
    expect((await readdir(dir)).sort()).toEqual(['3.jpg', '4.jpg']) // ≤ 210 bayt; en yeniler kaldı
  })

  it('her sweepEveryWrites yazmada süpürür', async () => {
    let n = 0
    const store = new ArtworkStore({
      dir,
      maxBytes: 1_500,
      lowWaterRatio: 0.5,
      sweepEveryWrites: 2,
      fetch: async () => image()
    })
    for (const name of ['a', 'b']) {
      expect(await store.fetch(SRC.replace('x.jpg', `${name}${n++}.jpg`))).toBe('ok')
    }
    // 2 × 1000 bayt > 1500 → 750'ye inene kadar en eskisi silinir
    expect(await readdir(dir)).toHaveLength(0)
  })
})
