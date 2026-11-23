import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { EASE_OUT } from '../shell/motion'

// Üst katman (şarkı / kart menüsü işleri; geliştirici kararları 2026-10-13): bağlam menüsü ("…" ve
// sağ tık, Apple Music gibi), kısa bildirim (ör. "Arşive eklendi") ve "Yeni Çalma Listesi" cam
// penceresi. Hepsi kabuğun en üstünde tek yerde çizilir (iç içe cam bozulmasın, taşmasın).

export type MenuEntry =
  | {
      kind: 'item'
      label: string
      icon?: LucideIcon
      onSelect: () => void
      disabled?: boolean
      /** Pasif öğenin nedeni (ör. Apple izin vermiyor); öğenin altında küçük yazılır. */
      hint?: string
      danger?: boolean
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; icon?: LucideIcon; items: MenuEntry[] }

/** §3.4: hata bildirimi daha uzun kalır; gerekirse tek düğme (ör. "Yeniden Giriş Yap"). */
export interface ToastOptions {
  tone?: 'error'
  action?: { label: string; onSelect: () => void }
}

interface OverlayApi {
  openMenu: (items: MenuEntry[], at: { x: number; y: number }) => void
  toast: (message: string, options?: ToastOptions) => void
  newPlaylist: (tracks?: Track[]) => void
}

const OverlayContext = createContext<OverlayApi | null>(null)

export function useOverlays(): OverlayApi {
  const value = useContext(OverlayContext)
  if (!value) throw new Error('OverlayProvider eksik')
  return value
}

const TOAST_MS = 2400
const ERROR_TOAST_MS = 6000

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{
    items: MenuEntry[]
    x: number
    y: number
    key: number
  } | null>(null)
  const [toast, setToast] = useState<{
    message: string
    key: number
    options?: ToastOptions
  } | null>(null)
  const [dialog, setDialog] = useState<{ tracks: Track[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!toast) return
    const ms = toast.options?.tone === 'error' || toast.options?.action ? ERROR_TOAST_MS : TOAST_MS
    const t = setTimeout(() => setToast(null), ms)
    return () => clearTimeout(t)
  }, [toast])

  const api = useMemo<OverlayApi>(
    () => ({
      openMenu: (items, at) => setMenu({ items, ...at, key: ++seq.current }),
      toast: (message, options) => setToast({ message, key: ++seq.current, options }),
      newPlaylist: (tracks = []) => {
        setMenu(null)
        setDialog({ tracks })
      }
    }),
    []
  )

  return (
    <OverlayContext.Provider value={api}>
      {children}
      <AnimatePresence>
        {menu && (
          <ContextMenu
            key={menu.key}
            items={menu.items}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.key}
            className={`glass glass--capsule toast${toast.options?.tone === 'error' ? ' toast--error' : ''}`}
            role={toast.options?.tone === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
          >
            <span>{toast.message}</span>
            {toast.options?.action && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.options?.action?.onSelect()
                  setToast(null)
                }}
              >
                {toast.options.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dialog && (
          <NewPlaylistDialog
            tracks={dialog.tracks}
            onClose={() => setDialog(null)}
            onDone={(message) => {
              setDialog(null)
              setToast({ message, key: ++seq.current })
            }}
          />
        )}
      </AnimatePresence>
    </OverlayContext.Provider>
  )
}

const MENU_MARGIN = 8

/** Menü: imleç konumunda açılır, pencereden taşmaz; dışarı tıklama, Esc, kaydırma ve yeniden boyutlandırma kapatır. */
function ContextMenu({
  items,
  x,
  y,
  onClose
}: {
  items: MenuEntry[]
  x: number
  y: number
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(MENU_MARGIN, Math.min(x, window.innerWidth - r.width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(y, window.innerHeight - r.height - MENU_MARGIN))
    })
    el.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus()
  }, [x, y])

  useEffect(() => {
    const onPointer = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const close = (): void => onClose()
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  return (
    <motion.div
      ref={ref}
      className="glass context-menu"
      role="menu"
      style={pos}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: { duration: 0.14, ease: EASE_OUT } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => menuKeys(e, onClose)}
    >
      <MenuList items={items} onClose={onClose} />
    </motion.div>
  )
}

/** ↑/↓ öğeler arasında, Esc kapatır, → alt menüye girer, ← alt menüden çıkar. */
function menuKeys(e: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  const list = (e.target as HTMLElement).closest('[role=menu]')
  if (!list) return
  const items = [
    ...list.querySelectorAll<HTMLElement>(
      ':scope > [role=menuitem], :scope > .context-menu__sub > [role=menuitem]'
    )
  ]
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape') {
    e.stopPropagation()
    onClose()
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }
}

function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null)
  return (
    <>
      {items.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={`s${i}`} className="context-menu__separator" role="separator" />
        }
        const Icon = entry.icon
        if (entry.kind === 'submenu') {
          return (
            <div
              key={entry.label}
              className="context-menu__sub"
              onPointerEnter={() => setOpenSub(i)}
              onPointerLeave={() => setOpenSub(null)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSub === i}
                className="context-menu__item"
                onClick={() => setOpenSub(openSub === i ? null : i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'Enter') {
                    e.preventDefault()
                    setOpenSub(i)
                  }
                }}
              >
                {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden="true" />}
                <span className="context-menu__label">{entry.label}</span>
                <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
              </button>
              {openSub === i && (
                <SubMenu items={entry.items} onClose={onClose} onBack={() => setOpenSub(null)} />
              )}
            </div>
          )
        }
        return (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            aria-disabled={entry.disabled === true}
            className={`context-menu__item${entry.danger ? ' context-menu__item--danger' : ''}${entry.disabled ? ' context-menu__item--disabled' : ''}`}
            title={entry.hint}
            onClick={() => {
              if (entry.disabled) return
              onClose()
              entry.onSelect()
            }}
          >
            {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden="true" />}
            <span className="context-menu__text">
              <span className="context-menu__label">{entry.label}</span>
              {entry.hint && <span className="context-menu__hint">{entry.hint}</span>}
            </span>
          </button>
        )
      })}
    </>
  )
}

/** Alt menü: ana menünün sağına (yer yoksa soluna) açılır. */
function SubMenu({
  items,
  onClose,
  onBack
}: {
  items: MenuEntry[]
  onClose: () => void
  onBack: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<'right' | 'left'>('right')
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - MENU_MARGIN) setSide('left')
    el.querySelector<HTMLElement>('[role=menuitem]')?.focus()
  }, [])
  return (
    <div
      ref={ref}
      className={`glass context-menu context-menu--sub context-menu--${side}`}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          e.stopPropagation()
          onBack()
          return
        }
        menuKeys(e, onClose)
      }}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  )
}

/** "Yeni Çalma Listesi" (geliştirici kararı: ortada cam pencere; ad + açıklama). */
function NewPlaylistDialog({
  tracks,
  onClose,
  onDone
}: {
  tracks: Track[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const app = useApp()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const create = useCallback(() => {
    const n = name.trim()
    if (!n || state === 'busy') return
    setState('busy')
    app.library
      .createPlaylist(n, {
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(tracks.length > 0 ? { tracks } : {})
      })
      .then(
        () => onDone(i18n.t('menu.toast.playlistCreated', { name: n })),
        () => setState('failed')
      )
  }, [app, name, description, tracks, state, onDone])

  return (
    <motion.div
      className="dialog-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        className="glass dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-playlist-title"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } }}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <h2 id="new-playlist-title" className="dialog__title">
          {i18n.t('menu.newPlaylistTitle')}
        </h2>
        <input
          className="settings-input dialog__input"
          value={name}
          maxLength={100}
          placeholder={i18n.t('menu.playlistName')}
          aria-label={i18n.t('menu.playlistName')}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create()
          }}
        />
        <textarea
          className="settings-input dialog__textarea"
          value={description}
          maxLength={1000}
          placeholder={i18n.t('menu.playlistDescription')}
          aria-label={i18n.t('menu.playlistDescription')}
          onChange={(e) => setDescription(e.target.value)}
        />
        {tracks.length > 0 && (
          <p className="dialog__note">
            {i18n.t('menu.playlistWithSongs', { count: tracks.length })}
          </p>
        )}
        {state === 'failed' && <p className="dialog__error">{i18n.t('menu.createFailed')}</p>}
        <div className="dialog__actions">
          <button type="button" className="pill-button" onClick={onClose}>
            {i18n.t('account.cancel')}
          </button>
          <button
            type="button"
            className="pill-button pill-button--danger"
            disabled={!name.trim() || state === 'busy'}
            onClick={create}
          >
            {i18n.t('menu.create')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
