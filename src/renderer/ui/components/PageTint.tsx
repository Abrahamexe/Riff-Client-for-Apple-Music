import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import type { Rgb } from '../nowplaying/palette'
import { useArtworkPalette } from '../hooks/useArtworkPalette'
import { AmbientOrbs } from './AmbientOrbs'
import { tintColors, type TintColors } from './tintColors'

// Sayfa arka plan tonu (geliştirici isteği 2026-10-18: "playlist, albüm ya da sanatçı sayfasına girince
// arka plan kapağın tonunda olsun, iOS Apple Music'teki gibi arka plana yedir"). Kapağın (sanatçıda
// fotoğrafın) baskın rengiyle başlayan, aşağı doğru uygulama arka planına eriyen renk katmanı.
//
// 2026-10-19: ton sayfanın içinde değil, tüm pencereyi kaplayan tek bir katmanda (`TintProvider`).
// Sayfa içindeyken (a) ana ekranın kenarında kırpılıyor, sağ panelin arkası koyu kalıyordu, (b) sayfa
// boyunca uzuyordu (1204 şarkılık listede 77.000 px'lik katman: bellek ve sağ panel açılırken kasma).
// Sayfa yalnızca rengini bildirir (`PageTint`); katman sayfa değişince eskisi söner, yenisi belirir.

interface TintApi {
  set: (id: string, colors: TintColors) => void
  clear: (id: string) => void
}

const TintContext = createContext<TintApi | null>(null)

/** Sayfanın rengini pencere katmanına bildirir; görsel yoksa / palet hazır değilse bir şey yapmaz. */
export function PageTint({
  artwork,
  size = 480
}: {
  artwork: string | null | undefined
  /** Sayfadaki kapağın istenen boyutu: aynı adres, tek istek (ayrı küçük kopya beklenmez). */
  size?: number
}) {
  const colors = tintColors(useArtworkPalette(artwork, size))
  const api = useContext(TintContext)
  const id = useId()
  const signature = colors ? `${colors.main.join(',')}|${colors.accent.join(',')}` : ''
  useEffect(() => {
    if (!api || !colors) return
    api.set(id, colors)
    return () => api.clear(id)
    // `colors` her çizimde yeni nesne: imzası bağımlılık (renk değişmedikçe yeniden bildirilmez).
  }, [api, id, signature])
  return null
}

interface Layer {
  key: number
  a: Rgb
  b: Rgb
  leaving: boolean
}

const FADE_OUT_MS = 600

/** Tüm pencereyi kaplayan ton katmanları; renk değişince eskisi söner, yenisi belirir. */
function TintHost({ colors }: { colors: TintColors | null }) {
  const [layers, setLayers] = useState<Layer[]>([])
  const seq = useRef(0)
  const signature = colors ? `${colors.main.join(',')}|${colors.accent.join(',')}` : ''
  useEffect(() => {
    setLayers((prev) => {
      const faded = prev.map((l) => ({ ...l, leaving: true }))
      return colors
        ? [...faded, { key: ++seq.current, a: colors.main, b: colors.accent, leaving: false }]
        : faded
    })
    const timer = setTimeout(() => setLayers((prev) => prev.filter((l) => !l.leaving)), FADE_OUT_MS)
    return () => clearTimeout(timer)
    // `colors` yerine imzası: aynı renkler tekrar bildirilince katman yenilenmez.
  }, [signature])
  return (
    <div className="page-tint-root" aria-hidden="true">
      {layers.map((l) => (
        <div
          key={l.key}
          className={`page-tint${l.leaving ? ' page-tint--leaving' : ''}`}
          style={{ '--tint-a': l.a.join(' '), '--tint-b': l.b.join(' ') } as CSSProperties}
        />
      ))}
    </div>
  )
}

/** Kabuğun en altına (ana ekrandan önce) oturur: ton ana ekranın ve panellerin arkasında kalır. */
export function TintProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: string; colors: TintColors } | null>(null)
  const api = useMemo<TintApi>(
    () => ({
      set: (id, colors) => setCurrent({ id, colors }),
      // Çıkan sayfa, gelen sayfanın rengini silmesin: yalnızca kendi kaydını temizler.
      clear: (id) => setCurrent((c) => (c?.id === id ? null : c))
    }),
    []
  )
  return (
    <TintContext.Provider value={api}>
      <AmbientOrbs dimmed={current !== null} />
      <TintHost colors={current?.colors ?? null} />
      {children}
    </TintContext.Provider>
  )
}
