import { describe, expect, it } from 'vitest'
import { miniKeyCommand } from './keys'

describe('MiniPlayer klavyesi', () => {
  it('boşluk / oklar komuta döner; diğer tuşlar yok sayılır', () => {
    expect(miniKeyCommand('Space')).toEqual({ type: 'togglePlay' })
    expect(miniKeyCommand('ArrowLeft')).toEqual({ type: 'previous' })
    expect(miniKeyCommand('ArrowRight')).toEqual({ type: 'next' })
    expect(miniKeyCommand('KeyA')).toBeNull()
    expect(miniKeyCommand('Escape')).toBeNull()
  })
})
