import type { CSSProperties } from 'react'
import { useArtworkPalette } from '../hooks/useArtworkPalette'
import { tintColors } from './tintColors'

// Sayfa arka plan tonu (geliştirici isteği 2026-10-18: "playlist, albüm ya da sanatçı sayfasına girince
// arka plan kapağın tonunda olsun, iOS Apple Music'teki gibi arka plana yedir"). Sayfanın üstünde
// kapağın (sanatçıda fotoğrafın) baskın rengiyle başlayan, aşağı doğru uygulama arka planına eriyen
// renk katmanı. İçerikle birlikte kayar; renk hazır olunca yumuşakça belirir.

export function PageTint({ artwork }: { artwork: string | null | undefined }) {
  const colors = tintColors(useArtworkPalette(artwork))
  if (!colors) return null
  return (
    <div
      className="page-tint"
      aria-hidden="true"
      style={
        {
          '--tint-a': colors.main.join(' '),
          '--tint-b': colors.accent.join(' ')
        } as CSSProperties
      }
    />
  )
}
