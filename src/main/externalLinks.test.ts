import { describe, expect, it } from 'vitest'
import { EXTERNAL_LINKS, SOURCE_LINK } from '@shared/ipc-contract'
import { EXTERNAL_LINK_URLS, externalLinkUrl, sourceLinkUrl } from './externalLinks'

describe('dış bağlantılar (PLAN_v5 P4, Güvenlik kuralı 7)', () => {
  it('sözleşmedeki her anahtarın sabit, doğrulanmış https adresi var', () => {
    expect(Object.keys(EXTERNAL_LINK_URLS).sort()).toEqual([...EXTERNAL_LINKS].sort())
    for (const link of EXTERNAL_LINKS) {
      const url = new URL(externalLinkUrl(link))
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('account.apple.com')
    }
  })

  it('aboneliği yönet: Apple Destek 118428’in verdiği adres', () => {
    expect(externalLinkUrl('manageSubscriptions')).toBe(
      'https://account.apple.com/account/manage/section/subscriptions'
    )
  })
})

describe('kaynak bağlantıları (müzik arka planı, Hakkında)', () => {
  const ok = [
    'https://en.wikipedia.org/wiki/Kanye_West',
    'https://tr.wikipedia.org/wiki/Bar%C4%B1%C5%9F_Man%C3%A7o',
    "https://en.wikipedia.org/wiki/Guns_N'_Roses",
    'https://www.wikidata.org/wiki/Q15935',
    'https://musicbrainz.org/recording/96266690-11b1-48bc-a90c-09d5a0f60611',
    'https://creativecommons.org/licenses/by-sa/4.0/',
    'https://lrclib.net/'
  ]
  const bad = [
    'http://en.wikipedia.org/wiki/X',
    'https://evil.example/wiki/X',
    'https://en.wikipedia.org.evil.example/wiki/X',
    'https://de.wikipedia.org/wiki/X',
    'https://en.wikipedia.org/w/index.php?title=X',
    'https://musicbrainz.org/recording/x/../../admin',
    'https://user:pw@musicbrainz.org/',
    'javascript:alert(1)',
    'https://lrclib.net/api/search?q=x'
  ]

  it('sözleşme kalıbı yalnızca izinli adresleri kabul eder', () => {
    for (const u of ok) expect(SOURCE_LINK.test(u), u).toBe(true)
    for (const u of bad) expect(SOURCE_LINK.test(u), u).toBe(false)
  })

  it('main ikinci kez doğrular (host, kullanıcı bilgisi, sorgu, port)', () => {
    for (const u of ok) expect(() => sourceLinkUrl(u), u).not.toThrow()
    for (const u of [
      'https://evil.example/',
      'https://user:pw@musicbrainz.org/',
      'https://musicbrainz.org:8443/',
      'https://lrclib.net/?x=1',
      'http://lrclib.net/'
    ]) {
      expect(() => sourceLinkUrl(u), u).toThrow()
    }
  })
})
