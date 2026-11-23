import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecureStore, SecureStoreError, type Cipher } from './secureStore'

// Gerçek safeStorage/DPAPI yerine sahte, tersinir bir şifreleyici; dosya içeriği düz metin olmamalı.
function fakeCipher(available = true): Cipher & { available: boolean } {
  const cipher = {
    available,
    isEncryptionAvailable: () => cipher.available,
    encryptString: (plain: string) => Buffer.from(`ENC1:${[...plain].reverse().join('')}`),
    decryptString: (buf: Buffer) => {
      const text = buf.toString()
      if (!text.startsWith('ENC1:')) throw new Error('çözülemedi')
      return [...text.slice(5)].reverse().join('')
    }
  }
  return cipher
}

const SECRET = 'dummy-music-user-token-abc123'
let dir: string
let filePath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-securestore-'))
  filePath = join(dir, 'auth.bin')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('SecureStore', () => {
  it('kaydeder ve geri yükler (yeni örnekle = uygulama yeniden açılışı)', async () => {
    const cipher = fakeCipher()
    await new SecureStore(filePath, cipher).save(SECRET)
    expect(await new SecureStore(filePath, cipher).load()).toBe(SECRET)
  })

  it('diskteki dosya düz metin token içermez', async () => {
    await new SecureStore(filePath, fakeCipher()).save(SECRET)
    const raw = (await readFile(filePath)).toString('latin1')
    expect(raw).not.toContain(SECRET)
  })

  it('dosya yoksa null döner', async () => {
    expect(await new SecureStore(filePath, fakeCipher()).load()).toBeNull()
  })

  it('şifreleme kullanılamıyorsa kaydetmez ve diske HİÇBİR ŞEY yazmaz', async () => {
    const store = new SecureStore(filePath, fakeCipher(false))
    await expect(store.save(SECRET)).rejects.toMatchObject({ code: 'STORE_ENCRYPTION_UNAVAILABLE' })
    expect(await readdir(dir)).toEqual([])
  })

  it('şifreleme kullanılamıyorsa okuma da STORE_ENCRYPTION_UNAVAILABLE verir', async () => {
    const cipher = fakeCipher()
    await new SecureStore(filePath, cipher).save(SECRET)
    cipher.available = false
    await expect(new SecureStore(filePath, cipher).load()).rejects.toBeInstanceOf(SecureStoreError)
  })

  it('bozuk dosyada çökmez: null döner ve dosyayı siler', async () => {
    await writeFile(filePath, 'rastgele bozuk içerik')
    const store = new SecureStore(filePath, fakeCipher())
    expect(await store.load()).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('boş dosyada da null döner ve siler', async () => {
    await writeFile(filePath, '')
    expect(await new SecureStore(filePath, fakeCipher()).load()).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('clear dosyayı siler ve olmayan dosyada hata vermez', async () => {
    const store = new SecureStore(filePath, fakeCipher())
    await store.save(SECRET)
    await store.clear()
    expect(await store.load()).toBeNull()
    await expect(store.clear()).resolves.toBeUndefined()
  })

  it('geçersiz değerleri reddeder', async () => {
    const store = new SecureStore(filePath, fakeCipher())
    for (const bad of ['', '   ', 'x'.repeat(20_000), 42 as unknown as string]) {
      await expect(store.save(bad)).rejects.toMatchObject({ code: 'STORE_INVALID_VALUE' })
    }
    expect(await readdir(dir)).toEqual([])
  })

  it('üzerine yazınca geçici dosya kalmaz', async () => {
    const store = new SecureStore(filePath, fakeCipher())
    await store.save('ilk-token')
    await store.save('ikinci-token')
    expect(await store.load()).toBe('ikinci-token')
    expect(await readdir(dir)).toEqual(['auth.bin'])
  })
})
