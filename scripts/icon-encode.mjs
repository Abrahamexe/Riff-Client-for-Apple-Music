// Uygulama ikonu kodlayıcıları (scripts/make-icons.cjs kullanır; saf fonksiyonlar, testli).
// Bağımlılık yok: ICO biçimi basit (başlık + dizin + görüntüler). 256 px PNG olarak, daha küçükler
// klasik 32 bit DIB olarak saklanır; NSIS ve eski Windows kabukları küçük PNG girdilerini okumaz.

/**
 * @typedef {{ size: number, png: Buffer, rgba: Buffer }} IconImage
 *   `rgba`: üstten alta satırlar, piksel başına R,G,B,A (canvas `getImageData` düzeni).
 */

/** Küçük boyut için BITMAPINFOHEADER + alttan üste BGRA + boş AND maskesi. */
export function encodeDib(size, rgba) {
  if (rgba.length !== size * size * 4) throw new Error(`rgba boyu ${size} px ile uyuşmuyor`)
  const maskRow = Math.ceil(size / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // XOR + AND maskesi
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const src = y * size * 4
    const dst = (size - 1 - y) * size * 4
    for (let x = 0; x < size * 4; x += 4) {
      pixels[dst + x] = rgba[src + x + 2]
      pixels[dst + x + 1] = rgba[src + x + 1]
      pixels[dst + x + 2] = rgba[src + x]
      pixels[dst + x + 3] = rgba[src + x + 3]
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)])
}

/** @param {IconImage[]} images küçükten büyüğe */
export function encodeIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size)
  const bodies = sorted.map((img) => (img.size >= 256 ? img.png : encodeDib(img.size, img.rgba)))
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2) // 1 = ikon
  head.writeUInt16LE(sorted.length, 4)
  const dir = Buffer.alloc(16 * sorted.length)
  let offset = 6 + dir.length
  sorted.forEach((img, i) => {
    const o = i * 16
    if (img.size > 256) throw new Error('ICO en fazla 256 px')
    dir.writeUInt8(img.size === 256 ? 0 : img.size, o)
    dir.writeUInt8(img.size === 256 ? 0 : img.size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(bodies[i].length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += bodies[i].length
  })
  return Buffer.concat([head, dir, ...bodies])
}

/** ICO dizinini okur (test ve doğrulama için): her girdinin boyu ve türü. */
export function readIcoDirectory(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('ICO değil')
  const count = buf.readUInt16LE(4)
  const out = []
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const size = buf.readUInt8(o) || 256
    const length = buf.readUInt32LE(o + 8)
    const offset = buf.readUInt32LE(o + 12)
    const isPng = buf.subarray(offset, offset + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    out.push({ size, length, offset, isPng })
  }
  return out
}

/** `src/main/platform/appIcon.ts` içeriği: tray ve pencere ikonu için PNG'ler (base64). */
export function appIconModule(pngBySize) {
  const sizes = Object.keys(pngBySize)
    .map(Number)
    .sort((a, b) => a - b)
  const lines = sizes.map((s) => `  ${s}: '${pngBySize[s].toString('base64')}'`)
  return [
    '// ÜRETİLMİŞ DOSYA — elle düzenleme. Kaynak: build/icon.svg, üretici: `npm run icons`',
    '// (scripts/make-icons.cjs). Tray ve pencere ikonu için PNG (base64).',
    '',
    'export const APP_ICON_PNG: Readonly<Record<number, string>> = {',
    lines.join(',\n'),
    '}',
    ''
  ].join('\n')
}
