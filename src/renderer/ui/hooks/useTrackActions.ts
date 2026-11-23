import { useEffect, useState } from 'react'
import type { RatingKind } from '@shared/ipc-contract'
import type { NowPlaying } from '@core/musickit/player'
import { useApp } from '../context'

// Çalan şarkının favori (yıldız) ve arşiv durumu (B3). Apple'da okunabilen ve geri alınabilen tek
// kişisel işaret puandır: yıldız = "sev" puanı (1), kaldırınca puan silinir. Arşive ekleme Apple'da
// geri alınamaz (docs/LIBRARY_WRITE.md); arşiv öğesi zaten arşivdedir, katalog şarkısı eklenince
// bu oturumda ✓ gösterilir (Apple'dan "arşivde mi" okunamıyor).

function ratingTarget(item: NowPlaying | null): { kind: RatingKind; id: string } | null {
  if (!item) return null
  if (item.catalogId) return { kind: 'songs', id: item.catalogId }
  return item.id ? { kind: 'library-songs', id: item.id } : null
}

const isLibraryItem = (item: NowPlaying): boolean => item.id.startsWith('i.')

export interface TrackActions {
  favorite: boolean
  inLibrary: boolean
  toggleFavorite: () => void
  addToLibrary: () => void
}

export function useTrackActions(item: NowPlaying | null): TrackActions {
  const app = useApp()
  const target = ratingTarget(item)
  const kind = target?.kind
  const id = target?.id
  const [favorite, setFavorite] = useState(false)
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setFavorite(false)
    if (!kind || !id) return
    let alive = true
    void app.library
      .getRatings(kind, [id])
      .then((r) => {
        if (alive) setFavorite(r.some((x) => x.value === 1))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [app, kind, id])

  return {
    favorite,
    inLibrary: item ? isLibraryItem(item) || added.has(item.id) : false,
    toggleFavorite: () => {
      if (!target) return
      const next = !favorite
      setFavorite(next)
      void app.library
        .setRating(target.kind, target.id, next ? 1 : null)
        .catch(() => setFavorite(!next))
    },
    addToLibrary: () => {
      if (!item?.catalogId) return
      const id = item.id
      setAdded((s) => new Set(s).add(id))
      void app.library.addToLibrary({ songs: [item.catalogId] }).catch(() =>
        setAdded((s) => {
          const copy = new Set(s)
          copy.delete(id)
          return copy
        })
      )
    }
  }
}
