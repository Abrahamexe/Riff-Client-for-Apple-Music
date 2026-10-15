import { useCallback, useEffect, useState } from 'react'
import type { LibrarySort, Track } from '@shared/ipc-contract'
import { i18n } from '@core/i18n'
import { useApp } from '../../context'
import { usePlayer } from '../../hooks/usePlayer'
import { playableId, TrackTable } from '../../components/TrackTable'
import { PageHeader, SortPicker, useScopeVersion } from './common'
import { useTrackMenu } from '../../overlays/itemMenus'

// Arşiv › Şarkılar (B4): tüm arşiv şarkıları, sanal tablo (50.000+ satır), ada / sanatçıya / son
// eklenene göre. Satıra basınca o şarkı çalar (Apple'ın otomatik çalması devam ettirir).

export function SongsPage() {
  const trackMenu = useTrackMenu()
  const app = useApp()
  const { player } = usePlayer()
  const [sort, setSort] = useState<LibrarySort>('name')
  const [total, setTotal] = useState(0)
  const version = useScopeVersion('songs')

  useEffect(() => {
    void app.library
      .getLibrarySongs({ limit: 1, sort })
      .then((p) => setTotal(p.total))
      .catch(() => {})
  }, [app, sort, version])

  const loadPage = useCallback(
    (offset: number, limit: number) =>
      app.library.getLibrarySongs({ offset, limit, sort }).then((p) => p.items),
    [app, sort]
  )
  const onPlay = useCallback(
    (t: Track) => {
      void player?.playSong(playableId(t)).catch(() => {})
    },
    [player]
  )

  return (
    <>
      <PageHeader title={i18n.t('nav.songs')}>
        <SortPicker value={sort} options={['name', 'artist', 'recent']} onChange={setSort} />
      </PageHeader>
      <TrackTable
        total={total}
        resetKey={`${sort}:${version}`}
        loadPage={loadPage}
        onPlay={onPlay}
        menu={(t) => trackMenu(t)}
      />
    </>
  )
}
