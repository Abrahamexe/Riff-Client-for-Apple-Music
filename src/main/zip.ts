import { CoreError } from '@shared/errors'
import { crc32, deflateRawSync } from 'node:zlib'

// Küçük ZIP yazıcısı (tanılama paketi, PLAN 2.3). Bağımlılık eklememek için (CLAUDE.md): yalnızca
// gereken alt küme — dosya girdileri, deflate, merkezi dizin. ZIP64 yok (paket birkaç MB).

export interface ZipEntry {
  name: string
  data: Buffer | string
}

const DOS_EPOCH = { date: (1 << 5) | 1, time: 0 } // 1980-01-01 00:00 (sabit: kararlı çıktı)

export function createZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(entry.name) || entry.name.includes('..')) {
      throw new CoreError('INVALID_ARGUMENT', `geçersiz zip girdisi adı: ${entry.name}`)
    }
    const name = Buffer.from(entry.name, 'utf8')
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data
    const compressed = deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // sürüm
    local.writeUInt16LE(0x0800, 6) // UTF-8 ad
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_EPOCH.time, 10)
    local.writeUInt16LE(DOS_EPOCH.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_EPOCH.time, 12)
    central.writeUInt16LE(DOS_EPOCH.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
