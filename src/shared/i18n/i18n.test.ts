import { describe, expect, it, vi } from 'vitest'
import { en } from './en'
import { I18n, placeholdersOf, resolveLocale, type Dictionary, type MessageKey } from './index'
import { tr } from './tr'

describe('sözlükler', () => {
  it('tr ve en aynı anahtarlara sahip', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort())
  })

  it('her anahtarda yer tutucular iki dilde aynı', () => {
    for (const key of Object.keys(tr) as MessageKey[]) {
      expect(placeholdersOf(en[key]), key).toEqual(placeholdersOf(tr[key]))
    }
  })

  it('boş çeviri yok', () => {
    for (const dict of [tr, en] as Dictionary[]) {
      for (const value of Object.values(dict)) expect(value.trim()).not.toBe('')
    }
  })

  it('eksik veya fazla anahtar derleme hatasıdır (tip testi)', () => {
    const { 'error.unknown': _omitted, ...withoutOne } = en
    // @ts-expect-error — eksik anahtar: Dictionary tüm tr anahtarlarını ister
    const missing: Dictionary = withoutOne
    // @ts-expect-error — fazla anahtar: tr'de olmayan anahtar kabul edilmez
    const extra: Dictionary = { ...en, 'error.fazla': 'x' }
    const i18n = new I18n(['tr-TR'])
    // @ts-expect-error — bilinmeyen anahtar
    i18n.t('error.yok')
    // @ts-expect-error — yer tutucusu olan anahtar parametre ister
    i18n.t('error.developerConfig')
    expect([missing, extra, _omitted]).toHaveLength(3)
  })
})

describe('resolveLocale', () => {
  it.each([
    [['tr-TR'], 'tr'],
    [['tr'], 'tr'],
    [['TR-tr'], 'tr'],
    [['en-US'], 'en'],
    [['de-DE', 'tr-TR'], 'en'], // birincil dil belirleyicidir
    [[], 'en']
  ] as const)('sistem %j → %s', (system, expected) => {
    expect(resolveLocale('system', system)).toBe(expected)
  })

  it('açık tercih sistem dilini ezer', () => {
    expect(resolveLocale('en', ['tr-TR'])).toBe('en')
    expect(resolveLocale('tr', ['en-US'])).toBe('tr')
  })
})

describe('I18n', () => {
  it('etkin dilde çevirir ve yer tutucuları doldurur', () => {
    const i18n = new I18n(['tr-TR'])
    expect(i18n.t('tray.quit')).toBe('Çıkış')
    expect(i18n.t('error.developerConfig', { fields: 'APPLE_TEAM_ID' })).toContain('APPLE_TEAM_ID')
  })

  it('dil değişince mesajlar değişir ve dinleyici çağrılır', () => {
    const i18n = new I18n(['tr-TR'])
    const listener = vi.fn()
    const off = i18n.onChange(listener)
    i18n.setPreference('en')
    expect(i18n.locale).toBe('en')
    expect(i18n.t('tray.quit')).toBe('Quit')
    expect(listener).toHaveBeenCalledWith('en')

    // Etkin dil değişmiyorsa (tr sistemde 'system' → tr, zaten tr değil) yalnızca gerçek değişim bildirilir.
    i18n.setPreference('en')
    expect(listener).toHaveBeenCalledTimes(1)

    off()
    i18n.setPreference('tr')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(i18n.t('tray.quit')).toBe('Çıkış')
  })

  it('format: eksik parametre yer tutucuyu olduğu gibi bırakır, değer HTML olarak işlenmez', () => {
    const i18n = new I18n(['en'])
    expect(i18n.format('error.developerConfig')).toContain('{fields}')
    expect(i18n.format('error.developerConfig', { fields: '<b>x</b>' })).toContain('<b>x</b>')
  })
})
