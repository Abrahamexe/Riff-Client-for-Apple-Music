import { describe, expect, it, vi } from 'vitest'
import type { WorkerApi } from '@shared/ipc-contract'
import type { LyricLine } from '@shared/lyrics'
import { activeLineIndex, LyricsClient, lyricsKey, shownLine } from './lyrics'

const synced: LyricLine[] = [
  { timeMs: 1_000, text: 'a' },
  { timeMs: 5_000, text: '' },
  { timeMs: 9_000, text: 'b' }
]

describe('activeLineIndex (B11b)', () => {
  it('başlangıcı geçmiş son satır; ilk satırdan önce -1', () => {
    expect(activeLineIndex(synced, 0)).toBe(-1)
    expect(activeLineIndex(synced, 999)).toBe(-1)
    expect(activeLineIndex(synced, 1_000)).toBe(0)
    expect(activeLineIndex(synced, 8_999)).toBe(1)
    expect(activeLineIndex(synced, 60_000)).toBe(2)
    expect(activeLineIndex([], 5_000)).toBe(-1)
  })

  it('zamansız (düz) sözlerde vurgu yok', () => {
    expect(activeLineIndex([{ timeMs: null, text: 'x' }], 5_000)).toBe(-1)
  })
})

describe('LyricsClient (B11b)', () => {
  it('worker sonucunu döner; hata katalog koduyla fırlar', async () => {
    const getLyrics = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { kind: 'none', lines: [] } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'BG_CANCELLED', message: 'iptal' }
      })
    const client = new LyricsClient({ getLyrics } as unknown as WorkerApi)
    const track = { title: 'Hurt', artist: 'Johnny Cash' }
    expect(await client.get(track)).toEqual({ kind: 'none', lines: [] })
    expect(getLyrics).toHaveBeenCalledWith({ track })
    await expect(client.get(track)).rejects.toMatchObject({ code: 'BG_CANCELLED' })
  })

  it('prefetch: worker’a iletilir; hata yutulur', async () => {
    const prefetchLyrics = vi.fn().mockRejectedValueOnce(new Error('kapalı'))
    const client = new LyricsClient({ prefetchLyrics } as unknown as WorkerApi)
    const track = { title: 'Hurt', artist: 'Johnny Cash' }
    await expect(client.prefetch(track)).resolves.toBeUndefined()
    expect(prefetchLyrics).toHaveBeenCalledWith({ track })
  })

  it('lyricsKey: aynı şarkı aynı anahtar; şarkı yoksa null', () => {
    const a = { title: 'Hurt', artist: 'Johnny Cash', durationMs: 1 }
    expect(lyricsKey(a)).toBe(lyricsKey({ ...a }))
    expect(lyricsKey(a)).not.toBe(lyricsKey({ ...a, album: 'X' }))
    expect(lyricsKey(null)).toBeNull()
  })
})

describe('shownLine (B11b)', () => {
  it('tıklanan satır süre dolana kadar gösterilir; sonra hesaplanan satır', () => {
    expect(shownLine(5, { index: 6, until: 1_000 }, 500)).toBe(6)
    expect(shownLine(9, { index: 2, until: 1_000 }, 500)).toBe(2)
    expect(shownLine(5, { index: 6, until: 1_000 }, 1_000)).toBe(5)
    expect(shownLine(5, null, 0)).toBe(5)
  })
})
