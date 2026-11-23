import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { redactUrlsInText } from './warnings'

// Log dosyası (PLAN 2.3, tanılama paketi için). Main, worker ve renderer logları tek dosyada; her
// satır yazılmadan önce temizlenir (Güvenlik kuralı 10 — kaynakta zaten maskeli olsa da ikinci savunma):
// URL sorgusu/fragment'ı, JWT benzeri token'lar, uzun gizli diziler, e-posta adresleri ve kullanıcı
// adı içeren Windows yolları. Dosya dönüşümlüdür (boyut sınırı, bir yedek). Yazma async ve sıralıdır.

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
/** 48+ karakterlik base64/hex dizi (token, imza, anahtar): ISRC/MBID gibi kısa kimlikler etkilenmez. */
const LONG_SECRET = /[A-Za-z0-9+/_=-]{48,}/g
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const WINDOWS_USER = /([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi
const POSIX_USER = /(\/(?:home|Users)\/)[^/\s"']+/g

export function sanitizeLogLine(line: string): string {
  return redactUrlsInText(line)
    .replace(JWT, '<jwt>')
    .replace(EMAIL, '<e-posta>')
    .replace(WINDOWS_USER, '$1<kullanıcı>')
    .replace(POSIX_USER, '$1<kullanıcı>')
    .replace(LONG_SECRET, '<gizli>')
}

export interface LogSinkOptions {
  dir: string
  /** Etkin dosya bu boyutu aşınca `app.1.log`'a döner (tek yedek). */
  maxBytes?: number
  /** Bellekteki son satırlar (tanılama paketi dosyaya erişemezse). */
  memoryLines?: number
  now?: () => Date
}

export class LogSink {
  private readonly file: string
  private readonly backup: string
  private readonly recent: string[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: LogSinkOptions) {
    this.file = join(options.dir, 'app.log')
    this.backup = join(options.dir, 'app.1.log')
  }

  write(scope: string, level: string, message: string): void {
    const ts = (this.options.now ?? (() => new Date()))().toISOString()
    const line = `${ts} ${level.padEnd(5)} [${scope}] ${sanitizeLogLine(message.replace(/\r?\n/g, ' ⏎ '))}`
    this.recent.push(line)
    const max = this.options.memoryLines ?? 2_000
    if (this.recent.length > max) this.recent.splice(0, this.recent.length - max)
    this.queue = this.queue.then(() => this.append(line + '\n')).catch(() => {})
  }

  /** Bekleyen yazmalar bitince çözülür (test ve çıkış). */
  flush(): Promise<void> {
    return this.queue
  }

  /** Tanılama paketi için: yedek + etkin dosya (yoksa bellektekiler). Ek bir temizlik geçişi yapılır. */
  async snapshot(): Promise<string> {
    await this.flush()
    const parts: string[] = []
    for (const f of [this.backup, this.file]) {
      try {
        parts.push(await readFile(f, 'utf8'))
      } catch {
        /* yok */
      }
    }
    const text = parts.length > 0 ? parts.join('') : this.recent.join('\n') + '\n'
    return text
      .split('\n')
      .map((l) => (l ? sanitizeLogLine(l) : l))
      .join('\n')
  }

  /** Son satırlar (bellekte). */
  lines(): readonly string[] {
    return this.recent
  }

  /** Çıkış (PLAN 2.5): log dosyaları silinir. */
  async clear(): Promise<void> {
    await this.flush()
    this.recent.length = 0
    await rm(this.file, { force: true })
    await rm(this.backup, { force: true })
  }

  private async append(text: string): Promise<void> {
    await mkdir(this.options.dir, { recursive: true })
    try {
      const { size } = await stat(this.file)
      if (size > (this.options.maxBytes ?? 1024 * 1024)) {
        await rm(this.backup, { force: true })
        await rename(this.file, this.backup)
      }
    } catch {
      /* dosya henüz yok */
    }
    await appendFile(this.file, text, 'utf8')
  }
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error'

/** Main'in console çıktısını (orijinal davranış korunarak) log dosyasına da yazar. */
export function captureConsole(
  sink: Pick<LogSink, 'write'>,
  scope: string,
  target: Pick<Console, ConsoleMethod> = console
): void {
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = target[method].bind(target)
    target[method] = (...args: unknown[]) => {
      original(...args)
      try {
        sink.write(scope, method === 'log' ? 'info' : method, args.map(stringify).join(' '))
      } catch {
        /* log yazılamadı: uygulamayı etkilemez */
      }
    }
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
