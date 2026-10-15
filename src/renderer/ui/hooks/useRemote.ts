import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '@shared/i18n'
import { i18n } from '@core/i18n'
import { useApp } from '../context'

// Ağdan gelen sayfa verisi (B5: albüm, sanatçı, katalog playlist'i; Ana Sayfa ile aynı desen):
// yükleniyor / hata / hazır. Oturum açılınca, bağlantı geri gelince, arayüz dili değişince
// (Apple başlıkları dile göre) ve kalıcı liste kaydı tazelenince (R2) yeniden ister. Hazır veri varken yenileme başarısız olursa eski veri
// kalır (sayfa boşalmaz). Geç gelen eski yanıt yeni sayfanın üstüne yazılmaz.

export type Remote<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T }

export function useRemote<T>(
  load: (locale: Locale) => Promise<T>,
  /** Sayfanın kimliği (ör. albüm id'si); değişince veri sıfırdan istenir. */
  key: string
): { remote: Remote<T>; reload: () => void } {
  const app = useApp()
  const [locale, setLocale] = useState(i18n.locale)
  const [remote, setRemote] = useState<Remote<T>>({ state: 'loading' })
  const loadRef = useRef(load)
  const generation = useRef(0)

  useEffect(() => {
    loadRef.current = load
  })
  useEffect(() => i18n.onChange(setLocale), [])

  const reload = useCallback(() => {
    const mine = ++generation.current
    setRemote((r) => (r.state === 'ready' ? r : { state: 'loading' }))
    loadRef.current(locale).then(
      (value) => {
        if (mine === generation.current) setRemote({ state: 'ready', value })
      },
      () => {
        if (mine === generation.current) {
          setRemote((r) => (r.state === 'ready' ? r : { state: 'failed' }))
        }
      }
    )
  }, [locale])

  // Yeni sayfa: önceki sayfanın verisi gösterilmez.
  useEffect(() => {
    setRemote({ state: 'loading' })
  }, [key])

  useEffect(() => {
    reload()
    const offSession = app.on('session', reload)
    const offReconnected = app.on('reconnected', reload)
    // R2: diskten gösterilen liste arka planda tazelendi; yeniden okuma worker belleğinden anında.
    const offRefreshed = app.library.onCatalogRefreshed(reload)
    return () => {
      generation.current++
      offSession()
      offReconnected()
      offRefreshed()
    }
  }, [app, reload, key])

  return { remote, reload }
}
