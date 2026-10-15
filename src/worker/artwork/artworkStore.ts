import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  artworkCacheKey,
  artworkFileName,
  MAX_ARTWORK_BYTES,
  parseArtworkSource,
  type ArtworkFetchResult
} from '@shared/artwork'
import { CoreError, logError } from '@shared/errors'
import { readLimited } from '../net/readLimited'

// Kapak görseli disk önbelleğinin ağ ve yazma tarafı (PLAN 2.2; PLAN_v5 A3.2: main'den taşındı —
// main'de ağ yok). Uygulama oturumu bellek içi olduğundan (PLAN 1.5) Chromium'un HTTP önbelleği
// diske yazılmaz; arayüz her açılışta tüm kapakları yeniden indirirdi. Main diskte olmayan kapağı
// buradan ister (`fetchArtwork`), dosya yazılınca kendisi sunar. Yanıt görsel türünde ve sınırlı
// boyutta olmalıdır. Boyut sınırı aşılınca en uzun süredir erişilmeyen dosyalar silinir (LRU: mtime;
// erişim zamanını main diskten sunarken günceller). Çıkışta main klasörü siler (PLAN 2.5).

export interface ArtworkStoreOptions {
  dir: string
  maxBytes: number
  /** Sınır aşılınca bu orana kadar küçültülür. */
  lowWaterRatio?: number
  /** Bu kadar yazmadan sonra boyut kontrolü yapılır (açılışta ayrıca bir kez). */
  sweepEveryWrites?: number
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}

export class ArtworkStore {
  private writes = 0
  private sweeping: Promise<void> | null = null
  private readonly inFlight = new Map<string, Promise<ArtworkFetchResult>>()
  /** Yazılmakta olan geçici dosyalar: süpürme bunları silmez. */
  private readonly writing = new Set<string>()

  constructor(private readonly options: ArtworkStoreOptions) {}

  /** Kapağı indirip önbellek klasörüne yazar. Aynı adres için süren indirme paylaşılır. */
  fetch(raw: string): Promise<ArtworkFetchResult> {
    const source = parseArtworkSource(raw)
    if (!source) return Promise.resolve('invalid')
    const file = join(
      this.options.dir,
      artworkFileName(source, createHash('sha256').update(artworkCacheKey(source)).digest('hex'))
    )
    let pending = this.inFlight.get(file)
    if (!pending) {
      pending = this.download(source, file).finally(() => this.inFlight.delete(file))
      this.inFlight.set(file, pending)
    }
    return pending
  }

  /** Boyut sınırı (açılışta ve her `sweepEveryWrites` yazmada). Eşzamanlı çağrılar birleşir. */
  sweep(): Promise<void> {
    this.sweeping ??= this.runSweep().finally(() => (this.sweeping = null))
    return this.sweeping
  }

  private async download(source: URL, file: string): Promise<ArtworkFetchResult> {
    // Main iki istek arasında dosyayı görmemiş olabilir: zaten yazılmışsa yeniden indirilmez.
    if (await exists(file)) return 'ok'
    let res: Response
    try {
      // P8 (F2): yönlendirme izlenmez (host doğrulaması yalnızca ilk adreste); 3xx → başarısız.
      res = await this.options.fetch(source.href, { redirect: 'manual' })
    } catch {
      return 'failed'
    }
    const contentType = res.headers.get('content-type') ?? ''
    const declared = Number(res.headers.get('content-length') ?? 0)
    // 2.7 D2: bildirilen boyut sınırı aşıyorsa gövde hiç okunmaz.
    if (!res.ok || !contentType.startsWith('image/') || declared > MAX_ARTWORK_BYTES) {
      await res.body?.cancel()
      return 'failed'
    }
    let data: Buffer | null
    try {
      data = await readLimited(res, MAX_ARTWORK_BYTES)
    } catch {
      return 'failed'
    }
    if (!data || data.length === 0) return 'failed'
    return (await this.store(file, data)) ? 'ok' : 'failed'
  }

  private async store(file: string, data: Buffer): Promise<boolean> {
    const tmp = `${file}.${process.pid}.tmp`
    this.writing.add(tmp)
    try {
      await mkdir(this.options.dir, { recursive: true })
      await writeFile(tmp, data)
      await rename(tmp, file)
    } catch {
      // Hata nesnesi loglanmaz: mesajı kullanıcı adını içeren dosya yolunu taşır (Güvenlik kuralı 10).
      logError('artwork', new CoreError('INTERNAL', 'Kapak önbelleğe yazılamadı.'))
      return false
    } finally {
      this.writing.delete(tmp)
    }
    if (++this.writes % (this.options.sweepEveryWrites ?? 100) === 0) await this.sweep()
    return true
  }

  private async runSweep(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.options.dir)
    } catch {
      return // klasör yok: önbellek boş
    }
    const entries: { path: string; size: number; mtime: number }[] = []
    for (const name of names) {
      const path = join(this.options.dir, name)
      try {
        const s = await stat(path)
        if (!s.isFile()) continue
        // Yarım kalmış geçici dosyalar silinir (süren yazmalar hariç).
        if (name.endsWith('.tmp')) {
          if (!this.writing.has(path)) await rm(path, { force: true })
          continue
        }
        entries.push({ path, size: s.size, mtime: s.mtimeMs })
      } catch {
        /* dosya bu arada silinmiş */
      }
    }
    let total = entries.reduce((sum, e) => sum + e.size, 0)
    if (total <= this.options.maxBytes) return
    const target = this.options.maxBytes * (this.options.lowWaterRatio ?? 0.9)
    entries.sort((a, b) => a.mtime - b.mtime)
    for (const e of entries) {
      if (total <= target) break
      await rm(e.path, { force: true })
      total -= e.size
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}
