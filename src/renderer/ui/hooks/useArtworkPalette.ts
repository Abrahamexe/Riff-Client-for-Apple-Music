import { useEffect, useState } from 'react'
import { cachedArtworkUrl } from '@core/data/artwork'
import { extractPalette, type Rgb } from '../nowplaying/palette'

// Kapağın / fotoğrafın baskın renkleri (büyük oynatıcı arka planı; 2026-10-18'den albüm, playlist ve
// sanatçı sayfalarının arka plan tonu). Önbellekli kopyadan 32×32 örneklenir (varsayılan 48 px; sayfa tonu sayfada zaten inen boyutu ister: ayrı küçük kopya yavaş CDN'de kapaktan sonra gelip sayfayı siyah bırakıyordu). Aynı görsel
// tekrar açılınca renk anında gelsin diye sonuçlar saklanır.

const CACHE_MAX = 300
const cache = new Map<string, Rgb[]>()

/** Görselin paleti; görsel yoksa ya da okunamazsa `null`. */
export function useArtworkPalette(template: string | null | undefined, size = 48): Rgb[] | null {
  const src = cachedArtworkUrl(template, size)
  const [palette, setPalette] = useState<Rgb[] | null>(() =>
    src ? (cache.get(src) ?? null) : null
  )
  useEffect(() => {
    if (!src) {
      setPalette(null)
      return
    }
    const known = cache.get(src)
    if (known) {
      setPalette(known)
      return
    }
    let live = true
    const img = new Image()
    img.onload = () => {
      if (!live) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 32, 32)
        const colors = extractPalette(ctx.getImageData(0, 0, 32, 32).data)
        if (cache.size >= CACHE_MAX) cache.clear()
        cache.set(src, colors)
        setPalette(colors)
      } catch {
        setPalette(null)
      }
    }
    img.src = src
    return () => {
      live = false
    }
  }, [src])
  return palette
}
