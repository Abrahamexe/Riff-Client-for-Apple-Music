import { redactUrl } from './security'

// Electron ve Node, süreç uyarılarına (process.emitWarning) tam URL yazabilir. Örnek (V3'te
// gözlendi): Apple giriş penceresi yüklenemeyince Electron "Failed to load URL: https://authorize.
// music.apple.com/woa?a=<developer token içeren parametre> with error: ..." uyarısını basar. Node'un
// varsayılan yazıcısı bunu olduğu gibi stderr'e yazar (Güvenlik kuralı 10). Varsayılan yazıcı,
// metindeki her URL'yi origin + yola indiren (sorgu ve fragment'ı atan) bir yazıcıyla değiştirilir.

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi

/** Metindeki URL'lerin sorgu ve fragment kısımlarını atar. */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => redactUrl(url))
}

/** `process`'in kullandığımız yüzeyi (testte EventEmitter ile değiştirilebilir). */
export interface WarningEmitter {
  removeAllListeners(event: 'warning'): unknown
  on(event: 'warning', listener: (warning: Error) => void): unknown
}

/**
 * Node'un varsayılan uyarı yazıcısını kaldırır, yerine redaksiyonlu yazıcı koyar. Uygulama
 * başlarken, Electron uyarı üretmeden önce bir kez çağrılır.
 */
export function installWarningRedaction(
  proc: WarningEmitter = process,
  write: (line: string) => void = (line) => console.warn(line)
): void {
  proc.removeAllListeners('warning')
  proc.on('warning', (warning) => {
    write(`[uyarı] ${warning.name || 'Warning'}: ${redactUrlsInText(String(warning.message))}`)
  })
}
