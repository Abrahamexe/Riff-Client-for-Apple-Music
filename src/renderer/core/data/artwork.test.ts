import { describe, expect, it } from 'vitest'
import { cachedArtworkUrl, sizedArtworkUrl } from './artwork'

describe('cachedArtworkUrl (2.2)', () => {
  it('şablonu boyutlandırıp önbellekli adrese çevirir; https değilse null', () => {
    const url = cachedArtworkUrl('https://is1-ssl.mzstatic.com/a/{w}x{h}bb.jpg', 300)!
    expect(url.startsWith('app://renderer/__art?u=')).toBe(true)
    expect(decodeURIComponent(url.split('u=')[1]!)).toBe(
      'https://is1-ssl.mzstatic.com/a/300x300bb.jpg'
    )
    expect(cachedArtworkUrl('http://x/{w}x{h}.jpg')).toBeNull()
    expect(cachedArtworkUrl(null)).toBeNull()
  })
})

describe('sizedArtworkUrl (B6)', () => {
  const thumb = 'https://is1-ssl.mzstatic.com/image/thumb/Features/v4/e6/a9/x.png'
  it('boyutlu Apple CDN adresinin boyutunu değiştirir (kare ve geniş)', () => {
    expect(sizedArtworkUrl(`${thumb}/300x300sr.jpg`, 1280, 720)).toBe(`${thumb}/1280x720sr.jpg`)
    expect(sizedArtworkUrl(`${thumb}/300x300bb.jpg`, 1600)).toBe(`${thumb}/1600x1600bb.jpg`)
    expect(sizedArtworkUrl(`${thumb}/300x300.webp`, 96)).toBe(`${thumb}/96x96.webp`)
    expect(sizedArtworkUrl(`${thumb}/300x300SC.DN01.jpg?l=tr-TR`, 496)).toBe(
      `${thumb}/496x496SC.DN01.jpg?l=tr-TR`
    )
  })
  it('sınırlar: 16–3000 px', () => {
    expect(sizedArtworkUrl(`${thumb}/300x300bb.jpg`, 9000, 4)).toBe(`${thumb}/3000x16bb.jpg`)
  })
  it('Apple CDN dışı ya da kalıba uymayan adres olduğu gibi kalır', () => {
    const blob = 'https://store-001.blobstore.apple.com/sq-mq-us/x/image?X-Amz-Expires=300'
    expect(sizedArtworkUrl(blob, 900)).toBe(blob)
    expect(sizedArtworkUrl('https://example.com/image/thumb/a/300x300bb.jpg', 900)).toBe(
      'https://example.com/image/thumb/a/300x300bb.jpg'
    )
    expect(sizedArtworkUrl('https://is1-ssl.mzstatic.com/a/300x300bb.jpg', 900)).toBe(
      'https://is1-ssl.mzstatic.com/a/300x300bb.jpg'
    )
  })
})
