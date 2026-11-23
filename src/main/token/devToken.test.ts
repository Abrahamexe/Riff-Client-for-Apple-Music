import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDevTokenProvider, readDevEnv } from './devToken'
import { UnavailableTokenProvider } from './UnavailableTokenProvider'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-devenv-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('readDevEnv (yalnızca dev build)', () => {
  it('.env’i ayrıştırır ama process.env’e YAZMAZ (alt süreçler devralmaz)', async () => {
    const envPath = join(dir, '.env')
    await writeFile(envPath, '# yorum\nAPPLE_TEAM_ID=ABC123DEFG\nAPPLE_KEY_ID="KEY1234567"\n')
    const before = { ...process.env }
    expect(readDevEnv(envPath)).toEqual({ APPLE_TEAM_ID: 'ABC123DEFG', APPLE_KEY_ID: 'KEY1234567' })
    expect(process.env).toEqual(before)
    expect(process.env['APPLE_TEAM_ID']).toBe(before['APPLE_TEAM_ID'])
  })

  it('dosya yoksa boş nesne; hata loglanmaz', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(readDevEnv(join(dir, 'yok.env'))).toEqual({})
    expect(error).not.toHaveBeenCalled()
  })

  it('okunamayan dosya boş nesne döner; içerik değil yalnızca hata kodu loglanır', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(readDevEnv(dir)).toEqual({}) // klasör: EISDIR
    expect(error.mock.calls.flat().join(' ')).toMatch(/EISDIR/)
  })

  it('eksik alanları DevTokenProvider’ın açık hatasıyla bildirir', async () => {
    const envPath = join(dir, '.env')
    await writeFile(envPath, 'APPLE_TEAM_ID=ABC123DEFG\n')
    const saved = { ...process.env }
    delete process.env['APPLE_KEY_ID']
    delete process.env['APPLE_PRIVATE_KEY_PATH']
    try {
      await expect(createDevTokenProvider(envPath).getDeveloperToken()).rejects.toMatchObject({
        code: 'TOKEN_ENV_MISSING',
        fields: ['APPLE_KEY_ID', 'APPLE_PRIVATE_KEY_PATH']
      })
    } finally {
      process.env = saved
    }
  })
})

describe('UnavailableTokenProvider (production)', () => {
  it('.env/.p8 aramadan açık bir hata verir', async () => {
    await expect(new UnavailableTokenProvider().getDeveloperToken()).rejects.toMatchObject({
      code: 'TOKEN_PROVIDER_UNAVAILABLE'
    })
  })
})
