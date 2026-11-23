import { useLayoutEffect, useMemo } from 'react'
import { usePendingPlay } from '../hooks/pendingPlay'
import { useArtworkPalette } from '../hooks/useArtworkPalette'
import { displayedTrack, usePlayer } from '../hooks/usePlayer'
import { rgbCss, type Rgb } from '../nowplaying/palette'
import { coverAccent } from '../theme/accent'

// Tuş rengi çalan şarkının kapağından (theme/accent.ts). Kökte iki tema için değişken yazar; CSS etkin
// temanınkini seçer (ui.css). Ayrı, boş çizen bileşen: oynatıcı konumu her karede değiştiği için
// usePlayer'ı kabuğun kendisinde kullanmak tüm kabuğu yeniden çizerdi.

const NAMES = [
  '--cover-accent-dark',
  '--cover-on-accent-dark',
  '--cover-ambient-dark',
  '--cover-accent-light',
  '--cover-on-accent-light',
  '--cover-ambient-light'
] as const

/** Kapak paleti için önbellekte zaten olan boyut (alt oynatıcının küçük kapağı). */
const PALETTE_SOURCE_SIZE = 96

export function CoverAccent() {
  const { snapshot } = usePlayer()
  // Şarkı seçilince renk ses gelmeden yeni kapağa geçer (pendingPlay).
  const pending = usePendingPlay()
  const template = pending
    ? pending.artworkUrl
    : (displayedTrack(snapshot)?.artworkTemplate ?? null)
  const palette = useArtworkPalette(template, PALETTE_SOURCE_SIZE)
  const accent = useMemo(() => coverAccent(palette), [palette])
  useLayoutEffect(() => {
    const style = document.documentElement.style
    if (!accent) {
      for (const name of NAMES) style.removeProperty(name)
      return
    }
    const set = (name: (typeof NAMES)[number], rgb: Rgb, alpha = 1): void =>
      style.setProperty(name, rgbCss(rgb, alpha))
    set('--cover-accent-dark', accent.dark.accent)
    set('--cover-on-accent-dark', accent.dark.onAccent)
    set('--cover-ambient-dark', accent.dark.accent, 0.14)
    set('--cover-accent-light', accent.light.accent)
    set('--cover-on-accent-light', accent.light.onAccent)
    set('--cover-ambient-light', accent.light.accent, 0.12)
  }, [accent])
  return null
}
