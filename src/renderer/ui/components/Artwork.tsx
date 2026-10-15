import { useState } from 'react'
import { Disc3, ListMusic, MicVocal, Music } from 'lucide-react'
import { cachedArtworkUrl } from '@core/data/artwork'

// Kapak (B4): disk önbellekli Apple kapağı; yoksa temaya uygun yer tutucu. "Kapaktan büyüme"
// geçişinde kapak ayrıca uçmaz: sayfanın kendisi karttan büyür (Shell.tsx, zoomOrigin.ts). Geliştirici
// geri bildirimi 2026-10-14: büyüyen sayfanın içindeki paylaşımlı uçuş iki hareketi üst üste
// bindiriyordu, kapak fazla gidip geri oturuyordu.
// `wide`: 16:9 görsel (B6 canlı radyo kartları; Apple istasyon görselini bu orana kendisi düzenler).

const PLACEHOLDER = { song: Music, album: Disc3, playlist: ListMusic, artist: MicVocal }

export function Artwork({
  url,
  size,
  kind = 'album',
  className,
  round,
  wide
}: {
  url: string | null | undefined
  size: number
  kind?: keyof typeof PLACEHOLDER
  className?: string
  round?: boolean
  wide?: boolean
}) {
  const src = cachedArtworkUrl(url ?? null, size, wide ? Math.round((size * 9) / 16) : size)
  // Süresi dolmuş imzalı adres, ağ hatası vb.: kırık resim yerine yer tutucu.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const show = src !== null && src !== failedSrc
  const classes = `artwork${round ? ' artwork--round' : ''}${wide ? ' artwork--wide' : ''}${className ? ` ${className}` : ''}`
  const Icon = PLACEHOLDER[kind]
  return (
    <div className={classes}>
      {show ? (
        <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <span className="artwork__placeholder" aria-hidden="true">
          <Icon size={Math.max(16, Math.round(size / 5))} strokeWidth={1.5} />
        </span>
      )}
    </div>
  )
}
