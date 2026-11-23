import { en } from './en'
import { tr, type Dictionary, type MessageKey } from './tr'

// Hafif, tipli i18n (PLAN 1.3b). Kütüphane yok: sözlükler düz nesnelerdir, anahtar eksikse derleme
// kırılır, `{ad}` yer tutucuları tip düzeyinde çıkarılır. Main ve renderer kendi örneğini oluşturur;
// DOM'a veya Node'a bağımlı değildir.

export type { Dictionary, MessageKey }
export type Locale = 'tr' | 'en'
/** Kullanıcı tercihi; `system` = sistem dili Türkçe ise `tr`, değilse `en`. */
export type LocalePreference = Locale | 'system'

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { tr, en }

export type MessageParam = string | number
export type MessageParams = Readonly<Record<string, MessageParam>>

/** `"a {x} b {y}"` → `"x" | "y"` */
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | Placeholders<Rest>
  : never

/** Anahtarın yer tutucusu yoksa parametre verilmez; varsa hepsi zorunludur. */
export type ParamArgs<K extends MessageKey> = [Placeholders<(typeof tr)[K]>] extends [never]
  ? []
  : [params: { readonly [P in Placeholders<(typeof tr)[K]>]: MessageParam }]

const PLACEHOLDER = /\{(\w+)\}/g

/** Metindeki yer tutucu adları (test ve doğrulama için). */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!).sort()
}

/** Tercih + sistem dilleri → kullanılacak dil. İlk (birincil) sistem dili belirleyicidir. */
export function resolveLocale(
  preference: LocalePreference,
  systemLocales: readonly string[]
): Locale {
  if (preference !== 'system') return preference
  const primary = (systemLocales[0] ?? '').toLowerCase()
  return primary === 'tr' || primary.startsWith('tr-') ? 'tr' : 'en'
}

function interpolate(text: string, params: MessageParams | undefined): string {
  if (!params) return text
  // Değerler metin olarak eklenir; HTML olarak yorumlanmaz (çıktı her zaman textContent'e gider).
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  )
}

export class I18n {
  private preference: LocalePreference
  private current: Locale
  private readonly listeners = new Set<(locale: Locale) => void>()

  constructor(
    private readonly systemLocales: readonly string[],
    preference: LocalePreference = 'system'
  ) {
    this.preference = preference
    this.current = resolveLocale(preference, systemLocales)
  }

  get locale(): Locale {
    return this.current
  }

  get localePreference(): LocalePreference {
    return this.preference
  }

  /** Dil tercihini değiştirir; etkin dil değiştiyse dinleyiciler çağrılır. */
  setPreference(preference: LocalePreference): void {
    this.preference = preference
    const next = resolveLocale(preference, this.systemLocales)
    if (next === this.current) return
    this.current = next
    for (const listener of [...this.listeners]) listener(next)
  }

  /** Dil değişikliğini dinler; abonelikten çıkan bir fonksiyon döner. */
  onChange(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Tipli çeviri: yer tutucuları olan anahtarlar parametre ister. */
  t<K extends MessageKey>(key: K, ...[params]: ParamArgs<K>): string {
    return this.format(key, params)
  }

  /** Parametreleri çalışma zamanında belli olan çeviri (ör. hata nesnesindeki `params`). */
  format(key: MessageKey, params?: MessageParams): string {
    return interpolate(DICTIONARIES[this.current][key], params)
  }
}
