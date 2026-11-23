import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { TRACK_QUERY_MAX } from '@shared/trackQuery'
import { i18n } from '@core/i18n'

// Liste içinde arama (geliştirici kararları 2026-10-18): Çal / Karıştır / Sırala satırının sağında
// büyüteç; basınca kutuya açılır, yazdıkça şarkılar süzülür (ad, sanatçı, albüm). Esc ya da ✕
// temizler; kutu boşken odaktan çıkınca büyütece döner. Süzme sayfada (`shared/trackQuery`).

/** Yazma bitince sorgu (ms): her tuşta worker'a gitmesin. */
const DEBOUNCE_MS = 150

/** `value` değiştikten `ms` sonra güncellenen kopya. */
export function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export function PlaylistSearch({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(value !== '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  if (!open) {
    return (
      <button
        type="button"
        className="pill-button playlist-search__toggle"
        aria-label={i18n.t('playlist.search')}
        title={i18n.t('playlist.search')}
        onClick={() => setOpen(true)}
      >
        <Search size={16} aria-hidden="true" />
      </button>
    )
  }
  const close = (): void => {
    onChange('')
    setOpen(false)
  }
  return (
    <div className="playlist-search" role="search">
      <Search size={15} aria-hidden="true" />
      <input
        ref={input}
        type="text"
        className="playlist-search__input"
        value={value}
        maxLength={TRACK_QUERY_MAX}
        placeholder={i18n.t('playlist.search')}
        aria-label={i18n.t('playlist.search')}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          close()
        }}
        onBlur={() => {
          if (value === '') setOpen(false)
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="playlist-search__clear"
          aria-label={i18n.t('playlist.searchClear')}
          title={i18n.t('playlist.searchClear')}
          // Odak kutudan çıkıp kutu kapanmasın diye tıklama öncesi varsayılan engellenir.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
