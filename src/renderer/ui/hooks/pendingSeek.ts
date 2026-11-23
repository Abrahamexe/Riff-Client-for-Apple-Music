import { useEffect, useState } from 'react'

// Sarma sonrası bekleyen konum: player yeni konumu ~0,3 sn sonra bildirir; o arada çubuk eski yere
// geri zıplamasın diye hedef gösterilir. Bildirilen konum hedefe yaklaşınca ya da süre dolunca bırakılır.

/** Hedef ile bildirilen konum bu kadar yakınsa sarma tamamlanmış sayılır (sn). */
export const SEEK_SETTLE_S = 1.5
/** Bildirim gelmezse (hata, ağ) hedef en fazla bu kadar gösterilir (ms). */
export const SEEK_PENDING_MAX_MS = 2_000

export function seekSettled(target: number, reported: number, elapsedMs: number): boolean {
  return Math.abs(reported - target) < SEEK_SETTLE_S || elapsedMs > SEEK_PENDING_MAX_MS
}

export function usePendingSeek(reported: number): {
  value: number | null
  set: (target: number | null) => void
} {
  const [pending, setPending] = useState<{ target: number; at: number } | null>(null)
  useEffect(() => {
    if (!pending) return
    if (seekSettled(pending.target, reported, performance.now() - pending.at)) {
      setPending(null)
      return
    }
    const t = setTimeout(() => setPending(null), SEEK_PENDING_MAX_MS)
    return () => clearTimeout(t)
  }, [pending, reported])
  return {
    value: pending?.target ?? null,
    set: (target) => setPending(target === null ? null : { target, at: performance.now() })
  }
}
