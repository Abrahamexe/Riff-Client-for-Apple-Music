import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Clock3, Search, X } from 'lucide-react'
import type { SearchSuggestions } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import { Artwork } from '../components/Artwork'
import { cardRoute } from '../components/cardRoute'
import { playAction } from '../components/Sections'
import { SPRING_SOFT } from './motion'
import { useRouter } from './router'
import { useGo } from './scroll'
import { menuItems, moveFocus, type MenuItem } from './searchMenu'

// Üst arama çubuğu (B2) + açılır liste (B7; geliştirici kararı: Apple Music gibi). Boşken son
// aramalar (yalnızca bu bilgisayarda, çıkışta silinir) ve "Temizle"; yazarken Apple'ın önerdiği
// terimler + kapaklı en iyi eşleşmeler. Enter ya da terim → sonuç sayfası; eşleşmeye basınca
// sayfası açılır (şarkı / istasyon çalar). Ok tuşları + Enter + Esc ile kullanılır.
// Liste arama çubuğunun kardeşi: iç içe `backdrop-filter` camı bozar.

const BAR_WIDTH = 420
const BAR_WIDTH_FOCUSED = 480

export function SearchBar({ centerX }: { centerX: number }) {
  const app = useApp()
  const go = useGo()
  const { route } = useRouter()
  const { player } = usePlayer()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [term, setTerm] = useState('')
  const [focused, setFocused] = useState(false)
  const [recents, setRecents] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null)
  const [focus, setFocus] = useState(-1)

  useEffect(() => app.search.onSuggestions(setSuggestions), [app])
  // Sonuç sayfasındayken kutuda o sayfanın terimi (geri gelince de).
  const routeTerm = route.name === 'search' ? route.term : null
  useEffect(() => {
    if (routeTerm !== null) setTerm(routeTerm)
  }, [routeTerm])

  const loadRecents = useCallback(() => {
    app.search.recentSearches(8).then(
      (list) => setRecents(list.map((r) => r.term)),
      () => setRecents([])
    )
  }, [app])

  const items = menuItems(term, recents, suggestions)
  const open = focused && items.length > 0
  const empty = term.trim() === ''

  const change = (value: string): void => {
    setTerm(value)
    setFocus(-1)
    app.search.input(value)
    if (value.trim() === '') loadRecents()
  }
  const close = (): void => {
    setFocus(-1)
    inputRef.current?.blur()
  }
  const remember = (value: string): void => {
    void app.search.addRecent(value).catch(() => {})
  }
  const openResults = (value: string): void => {
    const q = value.trim()
    if (q === '') return
    setTerm(q)
    remember(q)
    close()
    go({ name: 'search', term: q })
  }
  const pick = (item: MenuItem): void => {
    if (item.kind !== 'top') {
      openResults(item.term)
      return
    }
    if (!empty) remember(term.trim())
    close()
    const target = cardRoute(item.card)
    if (target) go(target)
    else playAction(player, item.card)?.()
  }
  const clearRecents = (): void => {
    app.search.clearRecent().then(
      () => setRecents([]),
      () => {}
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setFocus((f) => moveFocus(f, e.key === 'ArrowDown' ? 1 : -1, open ? items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = open && focus >= 0 ? items[focus] : undefined
      if (item) pick(item)
      else openResults(term)
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <>
      <motion.div
        className={`glass glass--capsule searchbar${focused ? ' searchbar--focused' : ''}`}
        initial={false}
        animate={{ left: centerX, width: focused ? BAR_WIDTH_FOCUSED : BAR_WIDTH }}
        transition={SPRING_SOFT}
      >
        <Search className="searchbar__icon" size={17} strokeWidth={2} aria-hidden="true" />
        <input
          ref={inputRef}
          className="searchbar__input"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(open && focus >= 0 ? { 'aria-activedescendant': `${listId}-${focus}` } : {})}
          value={term}
          placeholder={i18n.t('search.placeholder')}
          aria-label={i18n.t('search.placeholder')}
          spellCheck={false}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true)
            // Kutuya dönünce: boşsa son aramalar, doluysa terimin önerileri yenilenir.
            if (term.trim() === '') loadRecents()
            else app.search.input(term)
          }}
          onBlur={() => {
            setFocused(false)
            setFocus(-1)
          }}
        />
        {term !== '' && (
          <button
            type="button"
            className="searchbar__clear"
            aria-label={i18n.t('search.clear')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => change('')}
          >
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.div
            key="menu"
            className="glass search-menu"
            style={{ left: centerX, width: BAR_WIDTH_FOCUSED }}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            // Liste tıklaması kutunun odağını almasın (blur listeyi kapatırdı).
            onMouseDown={(e) => e.preventDefault()}
          >
            {empty && (
              <div className="search-menu__header">
                <span>{i18n.t('search.recent')}</span>
                <button type="button" className="search-menu__clear" onClick={clearRecents}>
                  {i18n.t('search.clearRecent')}
                </button>
              </div>
            )}
            <ul id={listId} role="listbox" aria-label={i18n.t('search.placeholder')}>
              {items.map((item, i) => (
                <li
                  key={itemKey(item)}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === focus}
                  className={`search-menu__item${i === focus ? ' search-menu__item--focus' : ''}`}
                  onPointerEnter={() => setFocus(i)}
                  onClick={() => pick(item)}
                >
                  <MenuRow item={item} />
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

const itemKey = (item: MenuItem): string =>
  item.kind === 'top' ? `top:${item.card.kind}:${item.card.id}` : `${item.kind}:${item.term}`

function MenuRow({ item }: { item: MenuItem }) {
  if (item.kind !== 'top') {
    const Icon = item.kind === 'recent' ? Clock3 : Search
    return (
      <>
        <Icon className="search-menu__icon" size={16} strokeWidth={2} aria-hidden="true" />
        <span className="search-menu__text">{item.kind === 'term' ? item.label : item.term}</span>
      </>
    )
  }
  const { card } = item
  const kind = i18n.t(`search.kind.${card.kind}`)
  return (
    <>
      <Artwork
        url={card.artworkUrl}
        size={72}
        kind={card.kind === 'station' ? 'album' : card.kind}
        round={card.kind === 'artist'}
        className="search-menu__art"
      />
      <span className="search-menu__main">
        <span className="search-menu__text">{card.name}</span>
        <span className="search-menu__sub">
          {card.subtitle ? `${kind} · ${card.subtitle}` : kind}
        </span>
      </span>
    </>
  )
}
