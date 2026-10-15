import { describe, expect, it, vi } from 'vitest'
import type { CdmStatus } from '@shared/types'
import { CdmStatusTracker } from './cdm'

describe('CdmStatusTracker', () => {
  it('başlangıçta pending; whenReady çözülünce ready yayınlar', async () => {
    const tracker = new CdmStatusTracker()
    const seen: CdmStatus[] = []
    tracker.onChange((s) => seen.push(s))
    expect(tracker.current()).toEqual({ state: 'pending' })

    let resolve!: () => void
    const done = tracker.track(() => new Promise<void>((r) => (resolve = r)))
    // Bekleme sürerken durum pending kalır (pencere bunu beklemez).
    expect(tracker.current()).toEqual({ state: 'pending' })
    resolve()
    await done
    expect(tracker.current()).toEqual({ state: 'ready' })
    expect(seen).toEqual([{ state: 'ready' }])
  })

  it('hata reject edilmez; ComponentsError.errors mesajı error durumuna yazılır', async () => {
    const tracker = new CdmStatusTracker()
    const err = Object.assign(new Error('x'), { errors: [new Error('indirme başarısız')] })
    await expect(tracker.track(() => Promise.reject(err))).resolves.toBeUndefined()
    expect(tracker.current()).toEqual({ state: 'error', message: 'indirme başarısız' })
  })

  it('bilinmeyen hata için genel mesaj', async () => {
    const tracker = new CdmStatusTracker()
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Error olmayan red değeri kasıtlı
    await tracker.track(() => Promise.reject('?'))
    expect(tracker.current()).toEqual({ state: 'error', message: 'Widevine CDM kurulamadı.' })
  })

  it('abonelikten çıkılabilir; bir dinleyicinin hatası diğerini engellemez', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tracker = new CdmStatusTracker()
    const bad = vi.fn(() => {
      throw new Error('bozuk dinleyici')
    })
    const good = vi.fn()
    const off = tracker.onChange(vi.fn())
    tracker.onChange(bad)
    tracker.onChange(good)
    off()
    await tracker.track(async () => {})
    expect(good).toHaveBeenCalledWith({ state: 'ready' })
    vi.restoreAllMocks()
  })
})
