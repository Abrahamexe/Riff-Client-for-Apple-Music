import { describe, expect, it } from 'vitest'
import { filterTracks, foldText, queryTerms, trackMatches } from './trackQuery'

const t = (name: string, artistName = 'Sanatçı', albumName = 'Albüm') => ({
  name,
  artistName,
  albumName
})

describe('playlist içinde arama', () => {
  it('büyük/küçük harf ve Türkçe aksan duyarsız', () => {
    expect(foldText('IŞIK Şarkısı — Çığ!')).toBe('isik sarkisi cig')
    expect(foldText('İstanbul Beyoncé')).toBe('istanbul beyonce')
    expect(trackMatches(t('Işıklar Sönerken'), queryTerms('isik'))).toBe(true)
    expect(trackMatches(t('Seni Anlatabilmek'), queryTerms('ANLAT'))).toBe(true)
  })

  it('ad, sanatçı ve albümde arar; her kelime geçmeli, sıra önemsiz', () => {
    const song = t('Hasretinden Prangalar Eskittim', 'Ahmet Kaya', 'En İyileri')
    expect(trackMatches(song, queryTerms('kaya prangalar'))).toBe(true)
    expect(trackMatches(song, queryTerms('iyileri'))).toBe(true)
    expect(trackMatches(song, queryTerms('kaya tarkan'))).toBe(false)
  })

  it('boş sorgu her şeyi döndürür; sıra korunur', () => {
    const list = [t('B', 'X', 'Y'), t('A', 'X', 'Y'), t('Ab', 'X', 'Y')]
    expect(filterTracks(list, '  ')).toEqual(list)
    expect(filterTracks(list, 'a').map((x) => x.name)).toEqual(['A', 'Ab'])
    expect(queryTerms('  çok   boşluk ')).toEqual(['cok', 'bosluk'])
  })
})
