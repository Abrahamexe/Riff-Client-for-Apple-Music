import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'

// Cam açılır seçici (B6 "Yeni" tür seçicisi): kapsül düğme + altında kayan cam liste. Dışarı
// tıklayınca ya da Esc ile kapanır; ok tuşlarıyla gezilir, Enter seçer. Seçenek metinleri Apple'dan
// gelebilir → yalnızca metin olarak gösterilir.

export interface PickerOption {
  id: string
  label: string
}

export function Picker({
  label,
  value,
  options,
  onChange
}: {
  /** Erişilebilir ad (ör. "Tür"). */
  label: string
  value: string
  options: readonly PickerOption[]
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [focus, setFocus] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const current = options.find((o) => o.id === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  // Açılınca seçili öğe görünür ve odakta.
  useEffect(() => {
    if (!open) return
    const item = listRef.current?.children[focus] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [open, focus])

  const choose = (id: string): void => {
    setOpen(false)
    if (id !== value) onChange(id)
  }
  const toggle = (): void => {
    setFocus(
      Math.max(
        0,
        options.findIndex((o) => o.id === value)
      )
    )
    setOpen(!open)
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      toggle()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setFocus((f) => (f + step + options.length) % options.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[focus]
      if (option) choose(option.id)
    }
  }

  return (
    <div className="picker" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="picker__button glass glass--capsule"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
      >
        <span className="picker__value">{current?.label}</span>
        <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            key="list"
            id={listId}
            ref={listRef}
            className="picker__list glass"
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                className={`picker__option${i === focus ? ' picker__option--focus' : ''}`}
                onPointerEnter={() => setFocus(i)}
                onClick={() => choose(o.id)}
              >
                <span>{o.label}</span>
                {o.id === value && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}
