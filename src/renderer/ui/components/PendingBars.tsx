// Şarkı seçildi, ses henüz gelmedi (pendingPlay.ts): sıra numarasının yerinde nabız atan üç çubuk.
// Yalnızca `transform` canlanır (CSS, `.pending-bars`).

export function PendingBars({ label }: { label: string }) {
  return (
    <span className="pending-bars" role="img" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  )
}
