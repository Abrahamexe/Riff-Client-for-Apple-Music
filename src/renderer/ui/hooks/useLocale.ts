import { useSyncExternalStore } from 'react'
import type { Locale } from '@shared/i18n'
import { i18n } from '@core/i18n'

// Etkin arayüz dili (ayar değişince yeniden çizim; Shell dil değişince alt ağacı yeniden kurar).

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => i18n.onChange(listener),
    () => i18n.locale
  )
}
