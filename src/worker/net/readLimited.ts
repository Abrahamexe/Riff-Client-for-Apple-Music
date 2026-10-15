/**
 * Yanıt gövdesini en fazla `limit` bayt okur; aşılırsa akışı keser ve `null` döner (2.7 D2).
 * Bildirilen `content-length` güvenilmez: sınır akış okunurken uygulanır.
 */
export async function readLimited(res: Response, limit: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
