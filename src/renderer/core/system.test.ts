import { describe, expect, it, vi } from 'vitest'
import { onReconnect, refreshAfterReconnect } from './system'

function sources() {
  let resume: ((p: { reason: 'resume' }) => void) | null = null
  const online = new Set<() => void>()
  return {
    src: {
      onSystemResume: (l: (p: { reason: 'resume' }) => void) => {
        resume = l
        return () => (resume = null)
      },
      window: {
        addEventListener: (_t: 'online', l: () => void) => void online.add(l),
        removeEventListener: (_t: 'online', l: () => void) => void online.delete(l)
      }
    },
    resume: () => resume?.({ reason: 'resume' }),
    online: () => online.forEach((l) => l()),
    count: () => online.size + (resume ? 1 : 0)
  }
}

describe('onReconnect (2.3)', () => {
  it('uyanma ve ağ olaylarını birleştirir; kısa sürede gelen tekrarları yutar; söküldüğünde temizler', () => {
    const s = sources()
    const clock = { t: 0 }
    const seen: string[] = []
    const off = onReconnect(s.src, (r) => seen.push(r), { throttleMs: 5_000, now: () => clock.t })
    s.resume()
    s.online()
    clock.t += 6_000
    s.online()
    expect(seen).toEqual(['resume', 'online'])
    off()
    expect(s.count()).toBe(0)
  })
})

describe('refreshAfterReconnect (2.3)', () => {
  const base = () => ({
    isMusicKitLoaded: () => true,
    loadMusicKit: vi.fn(async () => {}),
    configuredAt: () => 0,
    reconfigure: vi.fn(async () => {}),
    syncLibrary: vi.fn(async () => {}),
    now: () => 30 * 60_000
  })

  it('MusicKit yüklenemediyse yükler ve senkronlar', async () => {
    const d = { ...base(), isMusicKitLoaded: () => false }
    expect(await refreshAfterReconnect(d)).toEqual(['loadMusicKit', 'syncLibrary'])
  })

  it('uzun süredir yapılandırılmışsa token tazelenir; yeniyse dokunulmaz', async () => {
    expect(await refreshAfterReconnect(base())).toEqual(['syncLibrary'])
    const old = { ...base(), now: () => 2 * 60 * 60_000 }
    expect(await refreshAfterReconnect(old)).toEqual(['reconfigure', 'syncLibrary'])
  })

  it('hatalar birbirini engellemez (çevrimdışı)', async () => {
    const d = {
      ...base(),
      isMusicKitLoaded: () => false,
      loadMusicKit: vi.fn(async () => Promise.reject(new Error('ağ yok'))),
      syncLibrary: vi.fn(async () => Promise.reject(new Error('ağ yok')))
    }
    expect(await refreshAfterReconnect(d)).toEqual([])
    expect(d.syncLibrary).toHaveBeenCalled()
  })

  it('bekleyen kütüphane yazmaları senkronizasyondan önce gönderilir (3.B2)', async () => {
    const order: string[] = []
    const d = {
      ...base(),
      flushPendingWrites: vi.fn(async () => void order.push('flush')),
      syncLibrary: vi.fn(async () => void order.push('sync'))
    }
    expect(await refreshAfterReconnect(d)).toEqual(['flushWrites', 'syncLibrary'])
    expect(order).toEqual(['flush', 'sync'])
  })
})
