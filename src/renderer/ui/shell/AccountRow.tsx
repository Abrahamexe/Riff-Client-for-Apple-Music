import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleUserRound, ExternalLink, LogIn, LogOut, Pencil } from 'lucide-react'
import { i18n } from '@core/i18n'
import { useApp, useSettings, useSignedIn } from '../context'
import { initials } from '../profile'

// Hesap satırı (B3 → B8; geliştirici kararı: "Apple Music gibi küçük menü"). Oturum kapalıyken
// "Apple ile Giriş Yap". Açıkken baş harf avatarı + ad (Apple adı/fotoğrafı vermiyor; kullanıcı bir
// kez yazar); basınca küçük menü: Adını düzenle (satır içinde; Enter kaydeder, Esc vazgeçer),
// Aboneliği Yönet (Apple sayfası tarayıcıda), Çıkış Yap (menü içinde onay sorar).
// Menü yan menünün camının içinde: iç içe `backdrop-filter` bozulduğu için cam değil, yarı opak yüzey.

type MenuState = 'closed' | 'open' | 'confirm'

export function AccountRow() {
  const signedIn = useSignedIn()
  if (signedIn === false) return <SignInRow />
  return <ProfileRow />
}

function SignInRow() {
  const app = useApp()
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const signIn = (): void => {
    setState('busy')
    app.signIn().then(
      () => setState('idle'),
      () => setState('failed')
    )
  }
  const label =
    state === 'busy'
      ? i18n.t('account.signingIn')
      : state === 'failed'
        ? i18n.t('account.signInFailed')
        : i18n.t('account.signIn')
  return (
    <button
      type="button"
      className="nav-item account-signin"
      disabled={state === 'busy'}
      onClick={signIn}
    >
      <LogIn className="nav-item__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="nav-item__label">{label}</span>
    </button>
  )
}

function ProfileRow() {
  const app = useApp()
  const name = useSettings()?.profile.displayName ?? ''
  const [menu, setMenu] = useState<MenuState>('closed')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Dışarı tıklayınca ya da Esc ile kapanır.
  useEffect(() => {
    if (menu === 'closed') return
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu('closed')
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu('closed')
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const save = (): void => {
    setEditing(false)
    const value = draft.trim().slice(0, 60)
    if (value !== name)
      void app.settings.update({ profile: { displayName: value } }).catch(() => {})
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') setEditing(false)
  }
  const startEdit = (): void => {
    setMenu('closed')
    setDraft(name)
    setEditing(true)
  }
  const manage = (): void => {
    setMenu('closed')
    void app.openExternal('manageSubscriptions').catch(() => {})
  }
  const signOut = (): void => {
    setMenu('closed')
    void app.signOut().catch(() => {})
  }

  const letters = initials(name)
  const avatar = letters ? (
    <span className="avatar" aria-hidden="true">
      {letters}
    </span>
  ) : (
    <CircleUserRound className="nav-item__icon" size={18} strokeWidth={1.75} aria-hidden="true" />
  )
  if (editing) {
    return (
      <div className="nav-item">
        {avatar}
        <input
          className="profile-input"
          value={draft}
          maxLength={60}
          placeholder={i18n.t('profile.namePlaceholder')}
          aria-label={i18n.t('profile.namePlaceholder')}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={save}
        />
      </div>
    )
  }
  return (
    <div className="account" ref={rootRef}>
      <AnimatePresence>
        {menu !== 'closed' && (
          <motion.div
            key="menu"
            className="account-menu"
            role="menu"
            aria-label={i18n.t('account.menu')}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {menu === 'open' ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu__item"
                  onClick={startEdit}
                >
                  <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                  {i18n.t(name ? 'profile.edit' : 'profile.addName')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu__item"
                  onClick={manage}
                >
                  <ExternalLink size={16} strokeWidth={1.9} aria-hidden="true" />
                  {i18n.t('account.manageSubscription')}
                </button>
                <div className="account-menu__separator" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="account-menu__item account-menu__item--danger"
                  onClick={() => setMenu('confirm')}
                >
                  <LogOut size={16} strokeWidth={1.9} aria-hidden="true" />
                  {i18n.t('account.signOut')}
                </button>
              </>
            ) : (
              <div className="account-menu__confirm" role="alertdialog">
                <p>{i18n.t('account.signOutConfirm')}</p>
                <div className="account-menu__actions">
                  <button type="button" className="pill-button" onClick={() => setMenu('open')}>
                    {i18n.t('account.cancel')}
                  </button>
                  <button
                    type="button"
                    className="pill-button pill-button--danger"
                    autoFocus
                    onClick={signOut}
                  >
                    {i18n.t('account.signOut')}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        className="nav-item"
        aria-haspopup="menu"
        aria-expanded={menu !== 'closed'}
        title={i18n.t('account.menu')}
        onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')}
      >
        {avatar}
        <span className="nav-item__label">{name || i18n.t('profile.addName')}</span>
      </button>
    </div>
  )
}
