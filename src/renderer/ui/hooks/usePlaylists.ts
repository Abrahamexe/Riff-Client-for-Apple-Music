import { useEffect, useState } from 'react'
import type { Playlist } from '@shared/ipc-contract'
import { useApp } from '../context'

// Kullanıcının çalma listeleri (yan menü, şarkı menüsü "Çalma Listesine Ekle"). Oturum açılınca ve
// listeler senkronla değişince yeniden okunur.

export function usePlaylists(): Playlist[] {
  const app = useApp()
  const [items, setItems] = useState<Playlist[]>([])
  useEffect(() => {
    const load = (): void => {
      void app.library
        .getPlaylists()
        .then((view) => setItems(view.items))
        .catch(() => {})
    }
    load()
    const offSession = app.on('session', load)
    const offChanged = app.library.onChanged((scope) => {
      if (scope.scope === 'playlists') load()
    })
    return () => {
      offSession()
      offChanged()
    }
  }, [app])
  return items
}
