import { describe, expect, it } from 'vitest'
import { initials } from './profile'

describe('profil baş harfleri', () => {
  it.each([
    ['İbrahim Hakkı Evin', 'İH'],
    ['ibrahim', 'İ'],
    ['  çağla   ışık ', 'ÇI'],
    ['', ''],
    ['😀 Ali', '😀A']
  ])('%s → %s', (name, expected) => expect(initials(name)).toBe(expected))
})
