import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type Settings } from '@shared/settings'
import type { IpcResult } from '@shared/types'
import type { MusicKitInstance } from '../musickit/types'
import { applyPlaybackSettings, SettingsClient } from './settings'

afterEach(() => vi.unstubAllGlobals())

function fakeApi() {
  let listener: ((s: Settings) => void) | null = null
  let stored = defaultSettings()
  return {
    getSettings: vi.fn(async (): Promise<IpcResult<Settings>> => ({ ok: true, value: stored })),
    updateSettings: vi.fn(async (patch: Partial<Settings>): Promise<IpcResult<Settings>> => {
      if (
        patch.playback &&
        (patch.playback as { streamingQuality?: string }).streamingQuality === 'x'
      )
        return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'geçersiz' } }
      stored = { ...stored, ...patch }
      return { ok: true, value: stored }
    }),
    onSettingsChanged: vi.fn((fn: (s: Settings) => void) => {
      listener = fn
      return () => (listener = null)
    }),
    /** Başka pencereden gelen değişiklik. */
    broadcast: (s: Settings) => listener?.(s)
  }
}

describe('SettingsClient (3.B3)', () => {
  it('yükler, günceller; başka pencereden gelen değişikliği dinleyicilere iletir', async () => {
    const api = fakeApi()
    const client = new SettingsClient(api as never)
    const seen: Settings[] = []
    client.onChange((s) => seen.push(s))
    await client.load()
    expect(client.current?.playback.streamingQuality).toBe('high')
    const other = {
      ...defaultSettings(),
      playback: { streamingQuality: 'standard', autoplay: true }
    } as Settings
    api.broadcast(other)
    expect(client.current).toEqual(other)
    expect(seen).toHaveLength(2)
    client.dispose()
    api.broadcast(defaultSettings())
    expect(seen).toHaveLength(2)
  })

  it('geçersiz güncelleme hata olarak döner, mevcut değer değişmez', async () => {
    const api = fakeApi()
    const client = new SettingsClient(api as never)
    await client.load()
    await expect(
      client.update({ playback: { streamingQuality: 'x' as never } })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(client.current?.playback.streamingQuality).toBe('high')
  })
})

describe('applyPlaybackSettings (3.B3)', () => {
  it('Apple ayarları MusicKit özelliklerine eşlenir; müstehcen kapalıysa kısıtlama açılır', () => {
    const music = {
      isAuthorized: true,
      musicUserToken: 't',
      restrictedEnabled: false,
      bitrate: 64,
      autoplayEnabled: true,
      privateEnabled: false
    }
    vi.stubGlobal('window', { MusicKit: { getInstance: () => music } })
    const s = defaultSettings()
    applyPlaybackSettings(music as unknown as MusicKitInstance, s)
    expect(music).toMatchObject({ bitrate: 256, autoplayEnabled: true, privateEnabled: false })
    applyPlaybackSettings(music as unknown as MusicKitInstance, {
      ...s,
      general: { useListeningHistory: false, language: 'system' },
      playback: { streamingQuality: 'standard', autoplay: false },
      restrictions: { allowExplicit: false }
    })
    expect(music).toMatchObject({
      bitrate: 64,
      autoplayEnabled: false,
      privateEnabled: true,
      restrictedEnabled: true
    })
  })
})
