import { describe, expect, it } from 'vitest'
import {
  isPlaybackActive,
  shortcutAction,
  SHORTCUTS,
  type FocusInfo,
  type KeyLike
} from './shortcuts'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  ...mods
})
const free: FocusInfo = { editable: false, keyboardButton: false }

describe('klavye kısayolları (§3.3)', () => {
  it('Boşluk çal / duraklat; basılı tutunca tekrarlamaz', () => {
    expect(shortcutAction(key(' '), free)).toBe('playPause')
    expect(shortcutAction(key(' ', { repeat: true }), free)).toBeNull()
  })

  it('Boşluk: yazı alanında yazı, klavyeyle odaklanmış düğmede düğme; fareyle tıklanmış düğmede çalar', () => {
    expect(shortcutAction(key(' '), { editable: true, keyboardButton: false })).toBeNull()
    expect(shortcutAction(key(' '), { editable: false, keyboardButton: true })).toBeNull()
    expect(shortcutAction(key(' '), free)).toBe('playPause')
  })

  it('Ctrl+ok: şarkı ve ses; değiştiricili / yazı alanında yok', () => {
    expect(shortcutAction(key('ArrowRight', { ctrlKey: true }), free)).toBe('next')
    expect(shortcutAction(key('ArrowLeft', { ctrlKey: true }), free)).toBe('previous')
    expect(shortcutAction(key('ArrowUp', { ctrlKey: true }), free)).toBe('volumeUp')
    expect(shortcutAction(key('ArrowDown', { ctrlKey: true, repeat: true }), free)).toBe(
      'volumeDown'
    )
    expect(shortcutAction(key('ArrowRight', { ctrlKey: true, repeat: true }), free)).toBeNull()
    expect(shortcutAction(key('ArrowRight', { ctrlKey: true, shiftKey: true }), free)).toBeNull()
    expect(shortcutAction(key('ArrowRight'), free)).toBeNull()
    expect(
      shortcutAction(key('ArrowLeft', { ctrlKey: true }), { editable: true, keyboardButton: false })
    ).toBeNull()
    expect(shortcutAction(key(' ', { ctrlKey: true }), free)).toBeNull()
    expect(shortcutAction(key('a', { ctrlKey: true }), free)).toBeNull()
  })

  it('çalıyor veya çalmaya çalışıyorsa Boşluk duraklatır; duraklıyken / boşta çalar', () => {
    for (const s of ['playing', 'loading', 'waiting', 'stalled', 'seeking']) {
      expect(isPlaybackActive(s), s).toBe(true)
    }
    for (const s of ['none', 'paused', 'stopped', 'ended', 'completed']) {
      expect(isPlaybackActive(s), s).toBe(false)
    }
  })

  it('Ayarlar listesi her eylemi bir kez içerir', () => {
    expect(SHORTCUTS.map((s) => s.action).sort()).toEqual(
      ['next', 'playPause', 'previous', 'volumeDown', 'volumeUp'].sort()
    )
  })
})
