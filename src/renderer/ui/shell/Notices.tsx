import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { WifiOff } from 'lucide-react'
import { userMessage } from '@shared/errors'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { usePlayer } from '../hooks/usePlayer'
import { useOverlays } from '../overlays/Overlays'
import { EASE_OUT } from './motion'
import { createErrorNoticeFilter, onlineTransition } from './noticeRules'

// Bildirimler (§3.4, geliştirici kararı 2026-10-14; karar mantığı `noticeRules.ts`):
//  - internet yokken arama çubuğunun altında kalıcı kapsül; dönünce "Bağlantı geri geldi";
//  - oynatıcı hataları (katalog mesajı; aynı hata 5 sn içinde tekrar edilmez);
//  - oturum düştü → "Yeniden Giriş Yap" düğmeli bildirim;
//  - kütüphane değişikliği Apple'da başarısız oldu (yerel değişiklik geri alındı).

export function Notices({ centerX }: { centerX: number }) {
  const app = useApp()
  const { toast } = useOverlays()
  const { player } = usePlayer()
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    let prev = navigator.onLine
    const update = (): void => {
      const next = navigator.onLine
      if (onlineTransition(prev, next) === 'restored') toast(i18n.t('notice.online'))
      prev = next
      setOnline(next)
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [toast])

  useEffect(() => {
    if (!player) return
    const notify = createErrorNoticeFilter()
    return player.on('error', (error) => {
      if (notify(error.code)) toast(userMessage(error, i18n), { tone: 'error' })
    })
  }, [player, toast])

  useEffect(
    () =>
      app.on('unauthorized', () =>
        toast(i18n.t('notice.sessionExpired'), {
          tone: 'error',
          action: {
            label: i18n.t('notice.signIn'),
            onSelect: () => void app.signIn().catch(() => {})
          }
        })
      ),
    [app, toast]
  )

  useEffect(
    () => app.library.onWriteFailed(() => toast(i18n.t('notice.writeFailed'), { tone: 'error' })),
    [app, toast]
  )

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          className="glass glass--capsule offline-pill"
          role="status"
          style={{ left: centerX }}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
        >
          <WifiOff size={14} strokeWidth={2.2} aria-hidden="true" />
          {i18n.t('notice.offline')}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
