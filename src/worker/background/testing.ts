import { setupServer } from 'msw/node'
import type { AnyHandler } from 'msw'
import { afterAll, afterEach, beforeAll } from 'vitest'

// Arka plan katmanı testleri için ortak yardımcılar (üretim koduna import edilmez).
// Testler gerçek servislere ASLA istek atmaz: MSW, eşleşmeyen her isteği hata yapar.

/** Dosya düzeyinde MSW sunucusu; eşleşmeyen istek testi başarısız kılar (gerçek ağa çıkılmaz). */
export function useMswServer(...handlers: AnyHandler[]) {
  const server = setupServer(...handlers)
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
  return server
}

/**
 * Sanal saat: `sleep(ms)` gerçekten beklemez, saati ilerletir. Hız sınırlayıcı ve geri çekilme
 * aynı saati kullanınca testler milisaniyede biter, zamanlar yine de doğrulanabilir.
 */
export function virtualClock(start = 1_700_000_000_000) {
  let t = start
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
      await Promise.resolve()
    },
    advance: (ms: number) => void (t += ms),
    sleeps
  }
}

export const TEST_USER_AGENT = 'RiffClient/0.0.0-test ( https://github.com/Abrahamexe )'

/**
 * Eşleşen isteklerde yanıt vermeden asılı kalan, `signal` iptal edilince `AbortError` ile biten
 * sahte `fetch` (diğer istekler MSW'ye gider). Gerçek bir fetch'i MSW altında yarıda kesmek sahte
 * soketi bozup sonraki testlere sızabildiği için iptal testleri bunu kullanır.
 */
export function hangingFetch(shouldHang: (url: URL) => boolean, hung: URL[] = []): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!shouldHang(url)) return fetch(input, init)
    hung.push(url)
    return new Promise<Response>((_, reject) => {
      const abort = (): void => reject(new DOMException('Aborted', 'AbortError'))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    })
  }
}
