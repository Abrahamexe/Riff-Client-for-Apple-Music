import { createHash } from 'node:crypto'
import { readFile, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ARTWORK_TYPES,
  artworkCacheKey,
  artworkExtension,
  artworkFileName,
  parseArtworkSource,
  sniffImageType,
  SNIFFED_EXTENSION,
  type ArtworkFetchResult
} from '@shared/artwork'

// Kapak görseli disk önbelleği, sunma tarafı (PLAN 2.2). Renderer kapağı
// `app://renderer/__art?u=<https mzstatic URL>` ile ister; protocol.ts bu modüle yönlendirir.
// PLAN_v5 A3.2: main ağa çıkmaz. Dosya diskteyse buradan sunulur; yoksa worker indirip yazar
// (`worker/artwork/artworkStore.ts`: doğrulama, boyut sınırı, LRU süpürmesi), sonra buradan sunulur.
// Dinleme alışkanlığını ele verebileceği için çıkışta silinir (PLAN 2.5).

export interface ArtworkCacheOptions {
  dir: string
  /** Worker'dan indirme ister; worker çalışmıyorsa `unavailable`. */
  fetchFromWorker: (url: string) => Promise<ArtworkFetchResult | 'unavailable'>
  now?: () => number
}

const STATUS: Readonly<Record<Exclude<ArtworkFetchResult, 'ok'> | 'unavailable', number>> = {
  invalid: 400,
  failed: 502,
  unavailable: 503
}

export class ArtworkCache {
  private readonly inFlight = new Map<string, Promise<Response>>()

  constructor(private readonly options: ArtworkCacheOptions) {}

  /** `app://renderer/__art?u=…` isteğini yanıtlar. */
  async handle(requestUrl: URL): Promise<Response> {
    const source = parseArtworkSource(requestUrl.searchParams.get('u'))
    if (!source) return new Response('Bad Request', { status: 400 })
    const ext = artworkExtension(source)
    // Uzantısız (blobstore) kapakta tür baytlardan belirlenir (`respond`).
    const type = ext === SNIFFED_EXTENSION ? null : ARTWORK_TYPES[ext]!
    const file = join(
      this.options.dir,
      artworkFileName(source, createHash('sha256').update(artworkCacheKey(source)).digest('hex'))
    )

    // Süren worker isteği önce: kayıt ancak dosya diske yazıldıktan sonra silinir (yarış yok).
    const running = this.inFlight.get(file)
    if (running) return (await running).clone()

    const cached = await this.readCached(file)
    if (cached) return respond(cached, type)

    let pending = this.inFlight.get(file)
    if (!pending) {
      pending = this.viaWorker(source.href, file, type).finally(() => this.inFlight.delete(file))
      this.inFlight.set(file, pending)
    }
    return (await pending).clone()
  }

  /** Çıkış: tüm kapak önbelleği silinir. */
  async clear(): Promise<void> {
    await rm(this.options.dir, { recursive: true, force: true })
  }

  private async viaWorker(href: string, file: string, type: string | null): Promise<Response> {
    const result = await this.options.fetchFromWorker(href)
    if (result !== 'ok') return new Response(null, { status: STATUS[result] })
    const data = await this.readCached(file)
    // Worker yazdı ama dosya okunamıyor (bu arada temizlendi): bir sonraki istekte yeniden denenir.
    return data ? respond(data, type) : new Response(null, { status: 502 })
  }

  private async readCached(file: string): Promise<Buffer | null> {
    try {
      const data = await readFile(file)
      // LRU: erişim zamanı mtime'a yazılır (hata yutulur; önbellek bozulmaz).
      const now = new Date((this.options.now ?? Date.now)())
      utimes(file, now, now).catch(() => {})
      return data
    } catch {
      return null
    }
  }
}

function respond(data: Buffer, declared: string | null): Response {
  const type = declared ?? sniffImageType(data)
  if (!type) return new Response(null, { status: 502 })
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'max-age=31536000, immutable' }
  })
}
