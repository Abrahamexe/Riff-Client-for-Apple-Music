import { describe, expect, it } from 'vitest'
import { countComposers, splitComposers } from './composers'

describe('besteciler (§3.6)', () => {
  it('Apple dizesi kişi kişi ayrılır', () => {
    expect(
      splitComposers('Ye, 88-Keys, Sheffmade, Quadwoofer, Assi Rahbbani & Mansour El Rahbani')
    ).toEqual(['Ye', '88-Keys', 'Sheffmade', 'Quadwoofer', 'Assi Rahbbani', 'Mansour El Rahbani'])
    expect(splitComposers('Lennon / McCartney; Harrison and Starr')).toEqual([
      'Lennon',
      'McCartney',
      'Harrison',
      'Starr'
    ])
    expect(splitComposers('Andrew Watt, andrew watt')).toEqual(['Andrew Watt'])
    expect(splitComposers(null)).toEqual([])
    // "and" yalnızca ayrı sözcükken ayırır.
    expect(splitComposers('Alexander Grant')).toEqual(['Alexander Grant'])
  })

  it('sayımlar kişi başına, ada göre sıralı', () => {
    expect(countComposers(['Ye, Mike Dean', 'ye & 88-Keys', null, 'Aubrey Drake Graham'])).toEqual([
      { name: '88-Keys', count: 1 },
      { name: 'Aubrey Drake Graham', count: 1 },
      { name: 'Mike Dean', count: 1 },
      { name: 'Ye', count: 2 }
    ])
  })
})
