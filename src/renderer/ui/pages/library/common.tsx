import { useEffect, useState, type ReactNode } from 'react'
import type { LibrarySort } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'

// Arşiv sayfalarının ortakları (B4): sıralama seçici ve "senkron değişti" sürümü.

const SORT_KEYS = {
  name: 'sort.name',
  artist: 'sort.artist',
  recent: 'sort.recent'
} as const

export function SortPicker({
  value,
  options,
  onChange
}: {
  value: LibrarySort
  options: readonly LibrarySort[]
  onChange: (sort: LibrarySort) => void
}) {
  return (
    <div
      className="segmented glass glass--capsule"
      role="radiogroup"
      aria-label={i18n.t('sort.label')}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          className={`segmented__item${o === value ? ' segmented__item--on' : ''}`}
          onClick={() => onChange(o)}
        >
          {i18n.t(SORT_KEYS[o])}
        </button>
      ))}
    </div>
  )
}

/** Kapsam senkronla değişince artar (liste yeniden okunur); oturum açılınca da. */
export function useScopeVersion(scope: 'songs' | 'albums' | 'artists' | 'playlists'): number {
  const app = useApp()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1)
    const offChanged = app.library.onChanged((s) => {
      if (s.scope === scope) bump()
    })
    const offSession = app.on('session', bump)
    return () => {
      offChanged()
      offSession()
    }
  }, [app, scope])
  return version
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-header">
      <h1 className="page__title">{title}</h1>
      {children && <div className="page-header__actions">{children}</div>}
    </div>
  )
}
