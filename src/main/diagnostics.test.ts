import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDiagnostics, diagnosticsFileName, recentErrorIds } from './diagnostics'
import { captureConsole, LogSink, sanitizeLogLine } from './logSink'
import { createZip } from './zip'

/** Test için minimal ZIP okuyucu (yerel başlıklar). */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let o = 0
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8)
    const size = buf.readUInt32LE(o + 18)
    const nameLen = buf.readUInt16LE(o + 26)
    const extra = buf.readUInt16LE(o + 28)
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString('utf8')
    const start = o + 30 + nameLen + extra
    const data = buf.subarray(start, start + size)
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8')
    o = start + size
  }
  return out
}

const JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJURUFNMTIzNDU2In0.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWc'
const USER_TOKEN = 'AmUserToken' + 'x7Q2'.repeat(30)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'am-diag-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sanitizeLogLine (2.3)', () => {
  it.each([
    [`token ${JWT} sızdı`, 'token <jwt> sızdı'],
    [`Music-User-Token: ${USER_TOKEN}`, 'Music-User-Token: <gizli>'],
    ['kullanıcı ali.veli@example.com', 'kullanıcı <e-posta>'],
    ['dosya C:\\Users\\ornek\\AppData\\x.db', 'dosya C:\\Users\\<kullanıcı>\\AppData\\x.db'],
    ['https://api.music.apple.com/v1/me?token=GIZLI#x', 'https://api.music.apple.com/v1/me'],
    [
      'NET_001 OFFLINE: ISRC GBUM71029604 mbid 1d1b2c3e',
      'NET_001 OFFLINE: ISRC GBUM71029604 mbid 1d1b2c3e'
    ]
  ])('%s', (input, expected) => expect(sanitizeLogLine(input)).toBe(expected))
})

describe('LogSink', () => {
  it('satırları temizleyerek dosyaya yazar ve döndürür (rotasyon)', async () => {
    const sink = new LogSink({ dir, maxBytes: 120, now: () => new Date(0) })
    for (let i = 0; i < 10; i++) sink.write('main', 'info', `satır ${i} ${JWT}`)
    const text = await sink.snapshot()
    expect(text).not.toContain(JWT)
    expect(text).toContain('satır 9 <jwt>')
    expect(text.split('\n').filter(Boolean).length).toBeLessThan(10) // eskiler döndü
    await sink.clear()
    expect(await sink.snapshot()).toBe('\n')
  })

  it('console yakalama: orijinal çıktı korunur, dosyaya da yazılır', async () => {
    const sink = new LogSink({ dir })
    const seen: unknown[][] = []
    const fake = {
      log: (...a: unknown[]) => seen.push(a),
      info: () => {},
      warn: () => {},
      error: () => {}
    }
    captureConsole(sink, 'main', fake)
    fake.log('merhaba', { a: 1 }, new Error('x'))
    expect(seen).toHaveLength(1)
    expect(await sink.snapshot()).toContain('[main] merhaba {"a":1} Error: x')
  })
})

describe('tanılama paketi (2.3)', () => {
  it('zip: sürümler, CDM, hata kodları ve maskeli loglar; kişisel veri yok', async () => {
    const sink = new LogSink({ dir })
    sink.write('worker', 'warn', 'NET_001 OFFLINE: Apple Music’e ulaşılamadı.')
    sink.write('main', 'error', `AUTH_003 AUTH_WINDOW_LOAD_FAILED: ${JWT} ali@example.com`)
    sink.write('renderer', 'warn', 'NET_001 OFFLINE: tekrar')
    const zip = await buildDiagnostics({
      sink,
      versions: { app: '0.1.0', electron: '44.1.0' },
      cdm: { state: 'ready' },
      safeMode: false,
      now: () => new Date(0)
    })
    const files = unzip(zip)
    expect(Object.keys(files).sort()).toEqual(['errors.txt', 'info.json', 'logs/app.log'])
    const info = JSON.parse(files['info.json']!) as { recentErrorCounts: Record<string, number> }
    expect(info.recentErrorCounts).toEqual({
      'NET_001 OFFLINE': 2,
      'AUTH_003 AUTH_WINDOW_LOAD_FAILED': 1
    })
    const all = Object.values(files).join('\n')
    expect(all).not.toContain(JWT)
    expect(all).not.toContain('ali@example.com')
  })

  it('hata kimlikleri ve dosya adı', () => {
    expect(recentErrorIds('a NET_001 OFFLINE b BG_005 BG_SOURCE_DISABLED c', 1)).toEqual([
      'BG_005 BG_SOURCE_DISABLED'
    ])
    expect(diagnosticsFileName(new Date(2026, 9, 12, 19, 5, 7))).toBe(
      'RiffClient-tanilama-20261012-190507.zip'
    )
  })

  it('zip yazıcısı geçersiz adları reddeder', () => {
    expect(() => createZip([{ name: '../kacis.txt', data: 'x' }])).toThrow()
    expect(() => createZip([{ name: 'C:\\x.txt', data: 'x' }])).toThrow()
  })
})
