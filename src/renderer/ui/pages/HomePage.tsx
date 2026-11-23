import { useCallback } from 'react'
import type { Card, CardGroup } from '@shared/ipc-contract'
import type { Locale } from '@shared/i18n'
import { i18n } from '@core/i18n'
import { useApp } from '../context'
import { useRemote } from '../hooks/useRemote'
import { LoadFailed, Sections } from '../components/Sections'

// Ana Sayfa (B4 ek; geliştirici: "Apple Music'te ne varsa olsun"): Apple'ın kişisel öneri rafları
// (Sana Özel Listeler, Son Çalınan, Diğer … Eserleri, Sadece Sana Özel, Senin İçin Yeni Çıkanlar …;
// başlıklar Apple'dan arayüz dilinde) + "Sık Çaldıkların". Raflar yana kayar; ilk raf (Apple'ın en
// üstteki kişisel seçkisi) büyük kartlarla. Hangi rafların geleceğine Apple karar verir.

/** "Sık Çaldıkların" rafı Apple'ın ikinci rafından (genelde "Son Çalınan") sonra gelir. */
const HEAVY_ROTATION_AT = 2

export function HomePage() {
  const app = useApp()
  const load = useCallback(
    async (locale: Locale): Promise<CardGroup[]> => {
      const [groups, heavy] = await Promise.all([
        app.library.getRecommendations(locale),
        // Sık çalınanlar ek raftır: alınamazsa Ana Sayfa yine açılır.
        app.library.getHeavyRotation(20).catch((): Card[] => [])
      ])
      if (heavy.length === 0) return groups
      const shelf = { id: 'heavy-rotation', title: i18n.t('home.heavyRotation'), cards: heavy }
      const at = Math.min(HEAVY_ROTATION_AT, groups.length)
      return [...groups.slice(0, at), shelf, ...groups.slice(at)]
    },
    [app]
  )
  const { remote, reload } = useRemote(load, 'home')

  return (
    <>
      <h1 className="page__title">{i18n.t('nav.home')}</h1>
      {remote.state === 'loading' && <ShelvesSkeleton />}
      {remote.state === 'failed' && (
        <LoadFailed message={i18n.t('home.loadFailed')} onRetry={reload} />
      )}
      {remote.state === 'ready' && remote.value.length === 0 && (
        <p className="page-message">{i18n.t('home.empty')}</p>
      )}
      {remote.state === 'ready' && <Sections groups={remote.value} firstSize="large" />}
    </>
  )
}

/** Yüklenirken raf iskeleti (kapak boyutlarında yumuşak kutular). */
export function ShelvesSkeleton({
  largeFirst = true,
  count = 3
}: {
  largeFirst?: boolean
  count?: number
}) {
  return (
    <div className="home-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, s) => {
        const size = s === 0 && largeFirst ? 'large' : 'regular'
        return (
          <div key={s} className={`shelf-v2 shelf-v2--${size}`}>
            <div className="skeleton skeleton--title" />
            <div className={`shelf-row shelf-row--${size}`}>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton skeleton--card" />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
