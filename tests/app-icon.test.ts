import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// Uygulama ikonu (2026-10-15): scripts/icon-encode.mjs kodlayıcıları + üretilmiş dosyaların tutarlılığı.

interface IcoEntry {
  size: number
  length: number
  offset: number
  isPng: boolean
}
interface IconImage {
  size: number
  png: Buffer
  rgba: Buffer
}
interface Encoder {
  encodeDib(size: number, rgba: Buffer): Buffer
  encodeIco(images: IconImage[]): Buffer
  readIcoDirectory(buf: Buffer): IcoEntry[]
  appIconModule(pngBySize: Record<number, Buffer>): string
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const fakePng = (): Buffer => Buffer.concat([PNG_SIG, Buffer.from('gövde')])
let enc: Encoder

beforeAll(async () => {
  enc = (await import(pathToFileURL(resolve('scripts/icon-encode.mjs')).href)) as Encoder
})

/** PNG IHDR'den genişlik × yükseklik. */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true)
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

describe('icon-encode', () => {
  it('DIB: başlık alanları, alttan üste BGRA, boş AND maskesi', () => {
    // 2×2: üst satır kırmızı, mavi; alt satır yeşil, yarı saydam beyaz.
    const rgba = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 128])
    const dib = enc.encodeDib(2, rgba)
    expect(dib.readUInt32LE(0)).toBe(40)
    expect(dib.readInt32LE(4)).toBe(2)
    expect(dib.readInt32LE(8)).toBe(4)
    expect(dib.readUInt16LE(14)).toBe(32)
    // İlk piksel = alt satırın ilki (yeşil) BGRA olarak.
    expect([...dib.subarray(40, 44)]).toEqual([0, 255, 0, 255])
    expect([...dib.subarray(44, 48)]).toEqual([255, 255, 255, 128])
    expect([...dib.subarray(48, 52)]).toEqual([0, 0, 255, 255])
    // Maske: 2 satır × 4 bayt, sıfır.
    expect(dib.length).toBe(40 + 16 + 8)
    expect(dib.subarray(56).every((b) => b === 0)).toBe(true)
  })

  it('DIB: rgba boyu uyuşmazsa reddeder', () => {
    expect(() => enc.encodeDib(4, Buffer.alloc(10))).toThrow()
  })

  it('ICO: dizin + gövdeler; 256 px PNG, küçükler DIB; sırayla', () => {
    const rgba16 = Buffer.alloc(16 * 16 * 4, 7)
    const ico = enc.encodeIco([
      { size: 256, png: fakePng(), rgba: Buffer.alloc(0) },
      { size: 16, png: fakePng(), rgba: rgba16 }
    ])
    const dir = enc.readIcoDirectory(ico)
    expect(dir.map((d) => [d.size, d.isPng])).toEqual([
      [16, false],
      [256, true]
    ])
    expect(dir[0]!.offset).toBe(6 + 2 * 16)
    expect(dir[1]!.offset).toBe(dir[0]!.offset + dir[0]!.length)
    expect(ico.length).toBe(dir[1]!.offset + dir[1]!.length)
  })

  it('ICO değilse okumaz', () => {
    expect(() => enc.readIcoDirectory(fakePng())).toThrow()
  })

  it('appIcon modülü boyut sırasıyla base64 yazar', () => {
    const text = enc.appIconModule({ 32: Buffer.from('b'), 16: Buffer.from('a') })
    expect(text).toContain("  16: 'YQ==',\n  32: 'Yg=='")
    expect(text).toContain('export const APP_ICON_PNG')
  })
})

describe('üretilmiş ikon dosyaları', () => {
  it('build/icon.ico Windows boyutlarını içerir, 256 px PNG', () => {
    const dir = enc.readIcoDirectory(readFileSync(resolve('build/icon.ico')))
    const sizes = dir.map((d) => d.size)
    for (const s of [16, 24, 32, 48, 64, 256]) expect(sizes).toContain(s)
    expect(dir.find((d) => d.size === 256)?.isPng).toBe(true)
  })

  it('build/icon.png 256 px', () => {
    expect(pngSize(readFileSync(resolve('build/icon.png')))).toEqual([256, 256])
  })

  it('appIcon.ts PNG boyutları anahtarlarıyla aynı (tray 16/32, pencere 256)', () => {
    const text = readFileSync(resolve('src/main/platform/appIcon.ts'), 'utf8')
    const entries = [...text.matchAll(/^ {2}(\d+): '([A-Za-z0-9+/=]+)'/gm)]
    expect(entries.map((m) => Number(m[1]))).toEqual([16, 32, 64, 256])
    for (const [, size, b64] of entries) {
      expect(pngSize(Buffer.from(b64!, 'base64'))).toEqual([Number(size), Number(size)])
    }
  })

  it('electron-builder.yml ikonu kullanır', () => {
    const yml = readFileSync(resolve('electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/^win:\n {2}icon: build\/icon\.ico$/m)
    expect(yml).toMatch(/^ {2}installerIcon: build\/icon\.ico$/m)
    expect(yml).toMatch(/^productName: Riff Client$/m)
  })
})
