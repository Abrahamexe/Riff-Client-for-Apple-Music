import { describe, expect, it } from 'vitest'
import { SOURCE_LINK } from '@shared/ipc-contract'
import { ABOUT_SOURCES, CC_BY_SA_URL } from './aboutSources'

describe('Hakkında kaynakları', () => {
  it('her bağlantı izinli kaynak kalıbına uyar', () => {
    for (const s of ABOUT_SOURCES) if (s.url) expect(SOURCE_LINK.test(s.url), s.name).toBe(true)
    expect(SOURCE_LINK.test(CC_BY_SA_URL)).toBe(true)
  })
})
