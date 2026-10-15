import type { MessageKey } from '@shared/i18n'

// Klavye kısayolları (§3.3, geliştirici kararı 2026-10-14: yalnızca çalma kısayolları; Ayarlar → Genel'de
// salt okunur liste). Apple Music (Windows) karşılıkları. Saf eşleme (testli); kabuk dinler ve uygular.
//  - Boşluk: çal / duraklat. Yazı alanında yazı yazar. Klavyeyle odaklanmış (`:focus-visible`) düğmede
//    düğmeye basar (erişilebilirlik); fareyle tıklanmış düğmede çal / duraklat (yoksa şarkı satırına
//    tıkladıktan sonra Boşluk o şarkıyı baştan başlatırdı). Basılı tutunca tekrarlamaz.
//  - Ctrl+→ / Ctrl+←: sonraki / önceki şarkı. Ctrl+↑ / Ctrl+↓: ses aç / kıs (basılı tutunca sürer).
//    Yazı alanında devre dışı (Ctrl+ok orada kelime atlar).

export type ShortcutAction = 'playPause' | 'next' | 'previous' | 'volumeUp' | 'volumeDown'

/** Tuş: çevrilen ad (`{ text }`) ya da her dilde aynı sembol / ad ("Ctrl", "→"). */
export type ShortcutKey = { text: MessageKey } | string

/** Ayarlar'daki liste: eylem adı + tuşlar. */
export const SHORTCUTS: readonly {
  action: ShortcutAction
  label: MessageKey
  keys: readonly ShortcutKey[]
}[] = [
  { action: 'playPause', label: 'shortcuts.playPause', keys: [{ text: 'shortcuts.key.space' }] },
  { action: 'next', label: 'shortcuts.next', keys: ['Ctrl', '→'] },
  { action: 'previous', label: 'shortcuts.previous', keys: ['Ctrl', '←'] },
  { action: 'volumeUp', label: 'shortcuts.volumeUp', keys: ['Ctrl', '↑'] },
  { action: 'volumeDown', label: 'shortcuts.volumeDown', keys: ['Ctrl', '↓'] }
]

/**
 * Boşluk'un duraklatacağı durumlar: çalıyor ya da çalmaya çalışıyor (yükleniyor, tampon bekliyor,
 * sarılıyor). Duman testi: şarkı yüklenirken basılan ikinci Boşluk duraklatmıyor, yeniden çalıyordu.
 */
const ACTIVE_STATES: ReadonlySet<string> = new Set([
  'playing',
  'loading',
  'waiting',
  'stalled',
  'seeking'
])

export function isPlaybackActive(state: string): boolean {
  return ACTIVE_STATES.has(state)
}

export interface KeyLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
}

export interface FocusInfo {
  /** Odak yazı yazılabilen bir öğede (input, textarea, select, contenteditable, metin rolleri). */
  editable: boolean
  /** Odak klavyeyle gelinmiş bir düğmede / bağlantıda (`:focus-visible`). */
  keyboardButton: boolean
}

export function shortcutAction(e: KeyLike, focus: FocusInfo): ShortcutAction | null {
  if (focus.editable || e.altKey || e.metaKey || e.shiftKey) return null
  if (!e.ctrlKey) {
    if (e.key !== ' ' || e.repeat || focus.keyboardButton) return null
    return 'playPause'
  }
  switch (e.key) {
    case 'ArrowRight':
      return e.repeat ? null : 'next'
    case 'ArrowLeft':
      return e.repeat ? null : 'previous'
    case 'ArrowUp':
      return 'volumeUp'
    case 'ArrowDown':
      return 'volumeDown'
    default:
      return null
  }
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'])
const BUTTON_LIKE =
  'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], summary'

/** Odaktaki öğenin kısayollar açısından durumu. */
export function focusInfo(el: Element | null): FocusInfo {
  if (!el || el === document.body) return { editable: false, keyboardButton: false }
  const tag = el.tagName
  const editable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el instanceof HTMLElement && el.isContentEditable) ||
    TEXT_ROLES.has(el.getAttribute('role') ?? '')
  const keyboardButton = !editable && el.matches(BUTTON_LIKE) && el.matches(':focus-visible')
  return { editable, keyboardButton }
}
