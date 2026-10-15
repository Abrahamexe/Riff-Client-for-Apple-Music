import { open, readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { CoreError } from '@shared/errors'

// PLAN 1.5 "şifresiz kopya kontrolü" aracı: bir sırrın (Music User Token) bir klasördeki (userData)
// herhangi bir dosyada şifresiz hâli var mı? Yaygın kodlamalarla aranır: UTF-8, UTF-16LE
// (Chromium Local Storage/LevelDB), base64/base64url (her hizalamada), URL- ve JSON-kaçışlı.
//
// Sınır: LevelDB/IndexedDB blokları Snappy ile SIKIŞTIRILMIŞ olabilir; sıkıştırılmış kopya bayt
// aramasıyla bulunamaz. Bu yüzden rapor ayrıca kalıcı tarayıcı depolama klasörlerini listeler
// (in-memory partition kullanıldığı sürece uygulamanın bölümü için hiç oluşmamalıdır).
//
// Rapor YALNIZCA dosya yollarını ve kodlama adlarını içerir; sır asla loglanmaz/döndürülmez.

export interface Needle {
  encoding: string
  bytes: Buffer
}

export interface ScanReport {
  scannedFiles: number
  scannedBytes: number
  /** Sırrın bulunduğu dosyalar (kök klasöre göreli) ve eşleşen kodlamalar. */
  matches: { file: string; encodings: string[] }[]
  /** Okunamayan (kilitli vb.) dosyalar: bunlar için "temiz" denemez. */
  unreadable: { file: string; code: string }[]
  /** Kalıcı Chromium depolama klasörleri (Local Storage, IndexedDB, Partitions/…). */
  persistentStorage: string[]
}

const MIN_SECRET_LENGTH = 16
const CHUNK_SIZE = 1 << 20

const PERSISTENT_STORAGE_DIRS = new Set([
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Service Worker',
  'WebStorage',
  'Partitions'
])

/**
 * Base64 kodlamasında sır, çevreleyen verinin hizalamasına göre 3 farklı biçimde görünür.
 * Her hizalama için sınırdaki (komşu baytlara bağlı) karakterler atılır, kararlı çekirdek kalır.
 */
function base64Cores(secret: Buffer, variant: 'base64' | 'base64url'): string[] {
  const cores: string[] = []
  for (let shift = 0; shift < 3; shift++) {
    const encoded = Buffer.concat([Buffer.alloc(shift), secret])
      .toString(variant)
      .replace(/=+$/, '')
    const head = [0, 2, 3][shift]!
    cores.push(encoded.slice(head, encoded.length - 3))
  }
  return cores
}

/** Sırrın aranacak tüm bayt dizileri (tekrarsız). */
export function secretNeedles(secret: string): Needle[] {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new CoreError(
      'INVALID_ARGUMENT',
      `Sır en az ${MIN_SECRET_LENGTH} karakter olmalı (yanlış pozitifleri önlemek için).`
    )
  }
  const raw = Buffer.from(secret, 'utf8')
  const candidates: [string, Buffer][] = [
    ['utf8', raw],
    ['utf16le', Buffer.from(secret, 'utf16le')],
    ['url-encoded', Buffer.from(encodeURIComponent(secret), 'utf8')],
    [
      'json-escaped',
      Buffer.from(JSON.stringify(secret).slice(1, -1).replace(/\//g, '\\/'), 'utf8')
    ],
    ...base64Cores(raw, 'base64').map((c): [string, Buffer] => ['base64', Buffer.from(c)]),
    ...base64Cores(raw, 'base64url').map((c): [string, Buffer] => ['base64url', Buffer.from(c)])
  ]
  const seen = new Set<string>()
  const needles: Needle[] = []
  for (const [encoding, bytes] of candidates) {
    const key = bytes.toString('hex')
    if (bytes.length === 0 || seen.has(key)) continue
    seen.add(key)
    needles.push({ encoding, bytes })
  }
  return needles
}

async function* walk(dir: string): AsyncGenerator<{ path: string; isDir: boolean }> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue // kök dışına çıkılmaz
    if (entry.isDirectory()) {
      yield { path, isDir: true }
      yield* walk(path)
    } else if (entry.isFile()) {
      yield { path, isDir: false }
    }
  }
}

/** Dosyayı parça parça okur; parça sınırına denk gelen eşleşmeler için örtüşme bırakır. */
async function findInFile(
  path: string,
  needles: readonly Needle[]
): Promise<{ found: string[]; bytes: number }> {
  const overlap = Math.max(...needles.map((n) => n.bytes.length)) - 1
  const found = new Set<string>()
  const handle = await open(path, 'r')
  let bytes = 0
  try {
    let carry = Buffer.alloc(0)
    const buffer = Buffer.alloc(CHUNK_SIZE)
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, null)
      if (bytesRead === 0) break
      bytes += bytesRead
      const window = Buffer.concat([carry, buffer.subarray(0, bytesRead)])
      for (const n of needles) if (window.includes(n.bytes)) found.add(n.encoding)
      carry = window.subarray(Math.max(0, window.length - overlap))
    }
  } finally {
    await handle.close()
  }
  return { found: [...found].sort(), bytes }
}

export async function scanForSecret(root: string, secret: string): Promise<ScanReport> {
  const needles = secretNeedles(secret)
  const report: ScanReport = {
    scannedFiles: 0,
    scannedBytes: 0,
    matches: [],
    unreadable: [],
    persistentStorage: []
  }
  for await (const entry of walk(root)) {
    const rel = relative(root, entry.path)
    if (entry.isDir) {
      const name = rel.split(sep).at(-1)!
      if (PERSISTENT_STORAGE_DIRS.has(name)) report.persistentStorage.push(rel)
      continue
    }
    try {
      // Boş dosyada sır olamaz; açık uygulamanın kilitlediği LevelDB `LOCK` dosyaları (0 bayt)
      // "okunamadı" sayılmasın (V3 gözlemi). stat kilitli dosyada da çalışır.
      if ((await stat(entry.path)).size === 0) {
        report.scannedFiles++
        continue
      }
      const { found, bytes } = await findInFile(entry.path, needles)
      report.scannedFiles++
      report.scannedBytes += bytes
      if (found.length > 0) report.matches.push({ file: rel, encodings: found })
    } catch (err) {
      report.unreadable.push({ file: rel, code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN' })
    }
  }
  return report
}
