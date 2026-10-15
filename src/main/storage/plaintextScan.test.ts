import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_PARTITION } from '../appOrigin'
import { runPlaintextCheck } from '../dev/plaintextCheck'
import { scanForSecret, secretNeedles } from './plaintextScan'
import { SecureStore, type Cipher } from './secureStore'

// Gerçekçi biçim: Music User Token'lar base64 benzeri uzun dizelerdir (değer uydurmadır).
const SECRET = 'AqTe5Xk/9pL+mQ2wZr7Vb3Nc8Yh1Js4Df6Gk0Lz/Pq9Rs2Tu5Vw8Xy1Ab4Cd7Ef0Gh3Ij6Kl9Mn2Op5Q=='

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'am-scan-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const put = async (rel: string, data: string | Buffer): Promise<void> => {
  await mkdir(join(root, rel, '..'), { recursive: true })
  await writeFile(join(root, rel), data)
}
const noise = (n: number) => randomBytes(n)

describe('scanForSecret', () => {
  it('temiz klasörde eşleşme yok', async () => {
    await put('Local State', '{"os_crypt":{"encrypted_key":"RFBBUEk..."}}')
    await put('Cache/data_0', noise(50_000))
    const report = await scanForSecret(root, SECRET)
    expect(report.matches).toEqual([])
    expect(report.scannedFiles).toBe(2)
  })

  it('boş dosyalar (LevelDB LOCK) açılmadan geçilir, "okunamadı" sayılmaz', async () => {
    await put('Local Storage/leveldb/LOCK', '')
    const report = await scanForSecret(root, SECRET)
    expect(report.unreadable).toEqual([])
    expect(report.scannedFiles).toBe(1)
    expect(report.scannedBytes).toBe(0)
  })

  it.each<[string, (s: string) => Buffer]>([
    ['utf8', (s) => Buffer.concat([noise(10), Buffer.from(`{"token":"${s}"}`), noise(10)])],
    ['utf16le', (s) => Buffer.concat([noise(7), Buffer.from(s, 'utf16le'), noise(3)])],
    ['url-encoded', (s) => Buffer.from(`https://x/?t=${encodeURIComponent(s)}&a=1`)],
    ['json-escaped', (s) => Buffer.from(JSON.stringify({ t: s }).replace(/\//g, '\\/'))]
  ])('%s kopyayı bulur', async (encoding, make) => {
    await put('Partitions/x/Local Storage/leveldb/000003.log', make(SECRET))
    const report = await scanForSecret(root, SECRET)
    expect(report.matches).toHaveLength(1)
    expect(report.matches[0]!.encodings).toContain(encoding)
  })

  it.each([0, 1, 2, 5])(
    'daha büyük bir verinin içinde base64/base64url kodlanmış kopyayı bulur (öncesinde %i bayt)',
    async (prefix) => {
      const blob = Buffer.concat([noise(prefix), Buffer.from(SECRET), noise(9)])
      await put('a.txt', blob.toString('base64'))
      await put('b.txt', blob.toString('base64url'))
      const report = await scanForSecret(root, SECRET)
      const byFile = Object.fromEntries(report.matches.map((m) => [m.file, m.encodings]))
      // base64 ve base64url çekirdeği aynı olabilir (+ / içermiyorsa); tek etiketle raporlanır.
      const isB64 = (e: string[] | undefined) => !!e?.some((x) => x.startsWith('base64'))
      expect(isB64(byFile['a.txt'])).toBe(true)
      expect(isB64(byFile['b.txt'])).toBe(true)
    }
  )

  it('1 MB parça sınırına denk gelen kopyayı kaçırmaz', async () => {
    const at = (1 << 20) - 20
    await put('big.bin', Buffer.concat([noise(at), Buffer.from(SECRET), noise(1000)]))
    const report = await scanForSecret(root, SECRET)
    expect(report.matches).toEqual([{ file: 'big.bin', encodings: ['utf8'] }])
    expect(report.scannedBytes).toBe(at + SECRET.length + 1000)
  })

  it('safeStorage ile şifrelenmiş auth.bin eşleşmez (yalnızca şifresiz kopyalar)', async () => {
    const cipher: Cipher = {
      isEncryptionAvailable: () => true,
      encryptString: (s) =>
        Buffer.from(`v10${[...s].map((c) => c.charCodeAt(0) ^ 0x5a).join(',')}`),
      decryptString: () => SECRET
    }
    await new SecureStore(join(root, 'auth.bin'), cipher).save(SECRET)
    expect((await scanForSecret(root, SECRET)).matches).toEqual([])
  })

  it('kalıcı tarayıcı depolama klasörlerini raporlar', async () => {
    await put('Local Storage/leveldb/LOG', 'x')
    await put(`Partitions/${SESSION_PARTITION}/IndexedDB/x`, 'x')
    const report = await scanForSecret(root, SECRET)
    expect(report.persistentStorage.map((p) => p.replace(/\\/g, '/')).sort()).toEqual([
      'Local Storage',
      'Partitions',
      `Partitions/${SESSION_PARTITION}/IndexedDB`
    ])
  })

  it('sırrın parçası (kısmi token) eşleşme sayılmaz', async () => {
    await put('x', SECRET.slice(0, SECRET.length - 12))
    expect((await scanForSecret(root, SECRET)).matches).toEqual([])
  })

  it('kısa sır yanlış pozitif riski yüzünden reddedilir', () => {
    expect(() => secretNeedles('kısa')).toThrow()
  })
})

describe('runPlaintextCheck (dev aracı)', () => {
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).reverse().toString('hex')}`),
    decryptString: (b) => Buffer.from(b.toString().slice(4), 'hex').reverse().toString()
  }

  it('temizse true; logda sır yer almaz', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const store = new SecureStore(join(root, 'auth.bin'), cipher)
    await store.save(SECRET)
    expect(await runPlaintextCheck(root, store)).toBe(true)
    expect(info.mock.calls.flat().join(' ')).not.toContain(SECRET)
  })

  it('şifresiz kopya varsa false ve dosya yolunu (sırrı değil) loglar', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = new SecureStore(join(root, 'auth.bin'), cipher)
    await store.save(SECRET)
    await put('Session Storage/000001.log', Buffer.from(SECRET, 'utf16le'))
    expect(await runPlaintextCheck(root, store)).toBe(false)
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toContain('000001.log')
    expect(logged).not.toContain(SECRET)
  })

  it('kayıtlı token yoksa taramaz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runPlaintextCheck(root, new SecureStore(join(root, 'auth.bin'), cipher))).toBe(
      false
    )
    expect(warn).toHaveBeenCalled()
  })
})

describe('oturum bölümü (PLAN 1.5)', () => {
  it('ana pencere oturumu kalıcı değildir (persist: öneki yok)', () => {
    expect(SESSION_PARTITION.startsWith('persist:')).toBe(false)
    expect(SESSION_PARTITION).not.toBe('')
  })
})
