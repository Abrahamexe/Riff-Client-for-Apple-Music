import { describe, expect, it } from 'vitest'
import { playlistStart } from './playlistWindow'

describe('çalma listesinde şarkıdan başlatma', () => {
  it('ilk 100 şarkıda Apple’ın liste kuyruğu', () => {
    expect(playlistStart(0, 1229)).toEqual({ kind: 'playlist' })
    expect(playlistStart(99, 1229)).toEqual({ kind: 'playlist' })
  })

  it('sonrasında basılan şarkıdan başlayan 300’lük dilim (öncesi yok: atılan şarkı sırayı kaydırmasın)', () => {
    expect(playlistStart(100, 1229)).toEqual({ kind: 'window', offset: 100, limit: 300, start: 0 })
    expect(playlistStart(500, 1229)).toEqual({ kind: 'window', offset: 500, limit: 300, start: 0 })
    expect(playlistStart(1200, 1229)).toEqual({ kind: 'window', offset: 1200, limit: 29, start: 0 })
  })

  it('sıralı görünümde ilk 100 de dilimle (Apple liste sırası farklı)', () => {
    expect(playlistStart(3, 50, true)).toEqual({ kind: 'window', offset: 3, limit: 47, start: 0 })
  })
})
