// Dış kaynak metinlerini düz metne indirger (PLAN 3.A1, Güvenlik kuralı 6). Worker'da DOM yoktur;
// burada HTML yorumlanmaz, yalnızca etiketler atılır ve birkaç varlık çözülür. Sonuç HER ZAMAN metin
// olarak (textContent) render edilir; bu fonksiyon bir HTML temizleyici değildir, DOMPurify'ın yerini
// tutmaz — yalnızca saklanan veride işaretleme kalmamasını sağlar.

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ''
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/**
 * HTML etiketlerini atar, varlıkları çözer, kontrol karakterlerini ve fazla boşluğu temizler,
 * `maxLength` karakterde keser. Çözülen `<`/`>` metin olarak kalır (asla yeniden ayrıştırılmaz).
 */
export function toPlainText(value: string, maxLength = 10_000): string {
  const withoutTags = value
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  const text = decodeEntities(withoutTags)
    // eslint-disable-next-line no-control-regex -- kontrol karakterleri bilerek temizleniyor
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}
