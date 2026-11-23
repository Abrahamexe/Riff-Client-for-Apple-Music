import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CoreError, logError } from '@shared/errors'

// Music User Token yalnızca safeStorage (Windows'ta DPAPI) ile şifreli saklanır (Güvenlik kuralı 9).
// Şifreleme mümkün değilse token ASLA düz metin olarak diske yazılmaz.

/** Electron `safeStorage`'ın kullandığımız yüzeyi (testte sahte bir uygulamayla değiştirilebilir). */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export class SecureStoreError extends CoreError {
  constructor(code: 'STORE_ENCRYPTION_UNAVAILABLE' | 'STORE_INVALID_VALUE', message: string) {
    super(code, message)
    this.name = 'SecureStoreError'
  }
}

const MAX_VALUE_LENGTH = 16_384

export class SecureStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher
  ) {}

  isAvailable(): boolean {
    return this.cipher.isEncryptionAvailable()
  }

  async save(value: string): Promise<void> {
    if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_VALUE_LENGTH) {
      throw new SecureStoreError('STORE_INVALID_VALUE', 'Kaydedilecek değer geçersiz.')
    }
    this.assertAvailable()

    // Atomik yazım: yarım kalan yazma mevcut geçerli dosyayı bozmaz.
    const tmpPath = `${this.filePath}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(tmpPath, this.cipher.encryptString(value))
    await rename(tmpPath, this.filePath)
  }

  /**
   * Kayıtlı değeri döner; dosya yoksa `null`. Dosya bozuk veya çözülemiyorsa (elle değiştirilmiş,
   * başka Windows kullanıcısından kalmış) silinir ve `null` döner: uygulama çökmez, girişe yönlenir.
   */
  async load(): Promise<string | null> {
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    this.assertAvailable()

    try {
      const value = this.cipher.decryptString(encrypted)
      if (value.trim() !== '') return value
    } catch {
      // aşağıda temizlenir
    }
    logError(
      'secureStore',
      new CoreError(
        'STORE_CORRUPTED',
        'Kayıtlı dosya çözülemedi; siliniyor, yeniden giriş gerekecek.'
      )
    )
    await this.clear()
    return null
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true })
    await rm(`${this.filePath}.tmp`, { force: true })
  }

  private assertAvailable(): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new SecureStoreError(
        'STORE_ENCRYPTION_UNAVAILABLE',
        'Bu sistemde güvenli şifreleme (safeStorage) kullanılamıyor; oturum bilgisi diske yazılmayacak.'
      )
    }
  }
}
