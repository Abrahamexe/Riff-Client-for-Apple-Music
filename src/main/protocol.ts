import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, type Session } from 'electron'
import { APP_HOST, APP_SCHEME } from './appOrigin'
import { ARTWORK_ROUTE } from '@shared/artwork'

// Production'da renderer file:// yerine app://renderer/ origin'inden servis edilir:
// file:// origin'i MusicKit girişini bozabilir (PLAN §7). Şema standard + secure olduğu için
// EME/Widevine'ın gerektirdiği "secure context" sağlanır.

/** `app.whenReady()` ÖNCESİNDE çağrılmalıdır. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // 2.2: `codeCache` denendi; bellek içi oturumda kod önbelleği oluşmadı ve açılışta ölçülebilir
    // kazanç olmadı (docs/PERFORMANCE.md) → eklenmedi.
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/**
 * `app://renderer/<yol>` → paket içindeki dosya (PLAN 2.4: path traversal). Reddedilenler: geçersiz
 * yüzde kodlaması, NUL baytı, kök dışına çıkan yollar (`..`, kodlanmış `%2e%2e`, ters eğik çizgi,
 * mutlak yol) ve sembolik bağlantı / junction ile kök dışına işaret eden dosyalar (`realpath`).
 */
export async function resolveAppFile(
  rootDir: string,
  rawPathname: string
): Promise<{ file: string } | { status: 400 | 403 | 404 }> {
  let pathname: string
  try {
    pathname = decodeURIComponent(rawPathname)
  } catch {
    return { status: 400 }
  }
  if (pathname.includes(String.fromCharCode(0))) return { status: 400 }
  if (pathname === '/' || pathname === '') pathname = '/index.html'

  const filePath = join(rootDir, pathname)
  const rel = relative(rootDir, filePath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { status: 403 }

  // Sembolik bağlantı: gerçek yol da kökün içinde olmalı.
  let real: string
  let realRoot: string
  try {
    ;[real, realRoot] = await Promise.all([realpath(filePath), realpath(rootDir)])
  } catch {
    return { status: 404 }
  }
  const realRel = relative(realRoot, real)
  if (realRel === '' || realRel.startsWith('..') || isAbsolute(realRel)) return { status: 403 }
  return { file: real }
}

/**
 * `app.whenReady()` SONRASINDA çağrılmalıdır. `rootDir`: derlenmiş renderer klasörü.
 * Handler, pencerenin kullandığı session'a kaydedilmelidir (varsayılan session'a değil).
 */
export function registerAppProtocolHandler(
  session: Session,
  rootDir: string,
  artwork?: { handle(url: URL): Promise<Response> }
): void {
  session.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Forbidden', { status: 403 })
    // 2.2: kapak görseli disk önbelleği (artworkCache.ts); yalnızca GET.
    if (url.pathname === ARTWORK_ROUTE) {
      if (!artwork || request.method !== 'GET') return new Response('Not Found', { status: 404 })
      return artwork.handle(url)
    }

    const resolved = await resolveAppFile(rootDir, url.pathname)
    if ('status' in resolved) {
      return new Response(resolved.status === 404 ? 'Not Found' : 'Forbidden', {
        status: resolved.status
      })
    }
    try {
      return await net.fetch(pathToFileURL(resolved.file).toString())
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
