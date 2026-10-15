import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkFetchResult } from '@shared/artwork'
import { ArtworkCache } from './artworkCache'

// A3.2: main ağa çıkmaz; worker sahte (`fetchFromWorker`), dosyayı "yazmış" gibi diske koyar.
const SRC = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/x.jpg/512x512bb.jpg'
const req = (src: string): URL => new URL(`app://renderer/__art?u=${encodeURIComponent(src)}`)
const fileFor = (dir: string, src: string): string =>
  join(dir, `${createHash('sha256').update(new URL(src).href).digest('hex')}.jpg`)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-art-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Worker gibi davranır: dosyayı yazar ve `ok` döner. */
function writingWorker(bytes = 1_000) {
  return vi.fn(async (url: string): Promise<ArtworkFetchResult> => {
    await writeFile(fileFor(dir, url), new Uint8Array(bytes).fill(7))
    return 'ok'
  })
}

describe('ArtworkCache (2.2, A3.2: main yalnızca diskten sunar)', () => {
  it('diskte yoksa worker’a indirtir ve sunar; sonraki istek worker’a gitmez', async () => {
    const fetchFromWorker = writingWorker()
    const cache = new ArtworkCache({ dir, fetchFromWorker })
    const a = await cache.handle(req(SRC))
    expect(a.status).toBe(200)
    expect(a.headers.get('content-type')).toBe('image/jpeg')
    expect(a.headers.get('cache-control')).toContain('immutable')
    expect((await a.arrayBuffer()).byteLength).toBe(1_000)
    const b = await new ArtworkCache({ dir, fetchFromWorker }).handle(req(SRC)) // yeni açılış
    expect((await b.arrayBuffer()).byteLength).toBe(1_000)
    expect(fetchFromWorker).toHaveBeenCalledTimes(1)
    expect(fetchFromWorker).toHaveBeenCalledWith(new URL(SRC).href)
  })

  it('aynı anda gelen aynı görsel tek worker isteği', async () => {
    const fetchFromWorker = writingWorker()
    const cache = new ArtworkCache({ dir, fetchFromWorker })
    const [a, b] = await Promise.all([cache.handle(req(SRC)), cache.handle(req(SRC))])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(fetchFromWorker).toHaveBeenCalledTimes(1)
  })

  it('diskten sunarken erişim zamanı (LRU) güncellenir', async () => {
    const file = fileFor(dir, SRC)
    await writeFile(file, new Uint8Array(10))
    const cache = new ArtworkCache({ dir, fetchFromWorker: vi.fn(), now: () => 1_900_000_000_000 })
    expect((await cache.handle(req(SRC))).status).toBe(200)
    await vi.waitFor(async () => expect((await stat(file)).mtimeMs).toBe(1_900_000_000_000))
  })

  it('geçersiz kaynak → 400, worker’a gitmez', async () => {
    const fetchFromWorker = vi.fn()
    const cache = new ArtworkCache({ dir, fetchFromWorker })
    expect((await cache.handle(req('https://evil.com/x.jpg'))).status).toBe(400)
    expect(fetchFromWorker).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', 400],
    ['failed', 502],
    ['unavailable', 503]
  ] as const)('worker %s → %i', async (result, status) => {
    const cache = new ArtworkCache({ dir, fetchFromWorker: async () => result })
    expect((await cache.handle(req(SRC))).status).toBe(status)
  })

  it('worker ok dedi ama dosya yok → 502; sonraki istek yeniden dener', async () => {
    const fetchFromWorker = vi.fn(async (): Promise<ArtworkFetchResult> => 'ok')
    const cache = new ArtworkCache({ dir, fetchFromWorker })
    expect((await cache.handle(req(SRC))).status).toBe(502)
    expect((await cache.handle(req(SRC))).status).toBe(502)
    expect(fetchFromWorker).toHaveBeenCalledTimes(2)
  })

  it('çıkışta tamamen silinir', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(fileFor(dir, SRC), new Uint8Array(10))
    const cache = new ArtworkCache({ dir, fetchFromWorker: vi.fn() })
    await cache.clear()
    await expect(readdir(dir)).rejects.toThrow()
  })

  it('B4: uzantısız blobstore kapağı baytlardan türle sunulur; tanınmayan içerik 502', async () => {
    const src = 'https://store-033.blobstore.apple.com/sq/ab/image?X-Amz-Signature=1'
    const key = createHash('sha256')
      .update('https://store-033.blobstore.apple.com/sq/ab/image')
      .digest('hex')
    const file = join(dir, `${key}.img`)
    const cache = new ArtworkCache({ dir, fetchFromWorker: vi.fn() })
    await writeFile(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
    const ok = await cache.handle(req(src))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
    await writeFile(file, new TextEncoder().encode('<html>'))
    expect((await cache.handle(req(src))).status).toBe(502)
  })
})
