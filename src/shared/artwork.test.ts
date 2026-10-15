import { describe, expect, it } from 'vitest'
import {
  artworkCacheKey,
  artworkExtension,
  artworkFileName,
  parseArtworkSource,
  sniffImageType
} from './artwork'

const SRC = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/x.jpg/512x512bb.jpg'

describe('parseArtworkSource (yalnızca Apple görsel CDN’i)', () => {
  it.each([
    SRC,
    'https://is5-ssl.mzstatic.com/image/thumb/a/b/300x300bb.png',
    'https://is3-ssl.mzstatic.com/x/600x600.webp'
  ])('kabul: %s', (u) => expect(parseArtworkSource(u)).not.toBeNull())

  it.each([
    null,
    'http://is1-ssl.mzstatic.com/x.jpg',
    'https://evil.com/x.jpg',
    'https://is1-ssl.mzstatic.com.evil.com/x.jpg',
    'https://user:pw@is1-ssl.mzstatic.com/x.jpg',
    'https://is1-ssl.mzstatic.com:8443/x.jpg',
    'https://is1-ssl.mzstatic.com/x.svg',
    'https://is1-ssl.mzstatic.com/x.html',
    'file:///C:/Windows/win.ini',
    'x'.repeat(3000)
  ])('red: %s', (u) => expect(parseArtworkSource(u)).toBeNull())

  it('dosya adı: özet + küçük harfli uzantı', () => {
    const url = parseArtworkSource('https://is1-ssl.mzstatic.com/a/600x600.PNG')!
    expect(artworkFileName(url, 'ab12')).toBe('ab12.png')
  })

  it('B4: blobstore çalma listesi kapağı (uzantısız, süreli imzalı) kabul; anahtar imzasız', () => {
    const signed =
      'https://store-033.blobstore.apple.com/sq-mq-us-033-000002/ab/cd/image?X-Amz-Expires=3600&X-Amz-Signature=x1'
    const resigned = signed.replace('x1', 'y2')
    const a = parseArtworkSource(signed)!
    const b = parseArtworkSource(resigned)!
    expect(artworkExtension(a)).toBe('img')
    expect(artworkCacheKey(a)).toBe(artworkCacheKey(b))
    expect(artworkCacheKey(a)).not.toContain('X-Amz')
    // mzstatic'te anahtar tam adres (davranış değişmedi)
    const m = parseArtworkSource('https://is1-ssl.mzstatic.com/a/600x600.jpg?signature=s')!
    expect(artworkCacheKey(m)).toBe(m.href)
  })

  it.each([
    'http://store-033.blobstore.apple.com/x/image',
    'https://store-33.blobstore.apple.com/x/image',
    'https://store-033.blobstore.apple.com.evil.com/x/image',
    'https://evil.blobstore.apple.com/x/image',
    'https://u:p@store-033.blobstore.apple.com/x/image'
  ])('blobstore red: %s', (u) => expect(parseArtworkSource(u)).toBeNull())

  it('tür baytlardan: JPEG, PNG, WebP; tanınmayan null', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png')
    const webp = new TextEncoder().encode('RIFF\x00\x00\x00\x00WEBPVP8 ')
    expect(sniffImageType(webp)).toBe('image/webp')
    expect(sniffImageType(new TextEncoder().encode('<html>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
  })
})
