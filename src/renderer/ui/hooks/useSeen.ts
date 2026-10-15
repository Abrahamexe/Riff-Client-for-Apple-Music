import { useEffect, useState, type RefObject } from 'react'
import { useMainScroll } from '../shell/scroll'

// Öğe ana ekranda görünür alana yaklaştı mı (B6: Radyo'nun tür rafları ancak kaydırınca istenir →
// sayfa açılışında 13 istek birden atılmaz). Bir kez görününce `true` kalır.

/** Görünür alanın bu kadar altı / üstü de "yakın" sayılır (raf, kaydırma gelmeden yüklensin). */
const MARGIN = '600px 0px'

export function useSeen(ref: RefObject<Element | null>): boolean {
  const root = useMainScroll()
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (seen || !el || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true)
      },
      { root, rootMargin: MARGIN }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, root, seen])
  return seen
}
