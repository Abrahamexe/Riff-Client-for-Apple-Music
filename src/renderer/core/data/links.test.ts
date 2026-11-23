import { describe, expect, it } from 'vitest'
import { APPLE_MUSIC_LINK } from '@shared/ipc-contract'
import { appleMusicLink } from './links'

describe('Apple Music bağlantısı', () => {
  it('katalog öğesi → herkese açık bağlantı (main doğrulamasından geçer)', () => {
    const url = appleMusicLink('tr', 'playlist', 'pl.f4d106fed2bd41149aaacabb233eb5eb')!
    expect(url).toBe('https://music.apple.com/tr/playlist/pl.f4d106fed2bd41149aaacabb233eb5eb')
    expect(APPLE_MUSIC_LINK.test(url)).toBe(true)
    expect(appleMusicLink('tr', 'song', '1440806041')).toBe(
      'https://music.apple.com/tr/song/1440806041'
    )
  })
  it('arşiv kimliği, bozuk mağaza ya da kimlik → null', () => {
    expect(appleMusicLink('tr', 'song', 'i.abc')).toBeNull()
    expect(appleMusicLink('tr', 'playlist', 'p.abc')).toBeNull()
    expect(appleMusicLink('TR', 'album', '1')).toBeNull()
    expect(appleMusicLink('tr', 'album', '1/../x')).toBeNull()
  })
})
