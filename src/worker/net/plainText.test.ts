import { describe, expect, it } from 'vitest'
import { plainText } from './schemas'

describe('plainText (B5: Apple editoryal metinleri)', () => {
  it('etiketler ayıklanır, satır ve paragraf sonları korunur, varlıklar çözülür', () => {
    expect(plainText('<p>Bir <i>klasik</i>.</p><p>İkinci&nbsp;paragraf<br>yeni satır</p>')).toBe(
      'Bir klasik.\n\nİkinci paragraf\nyeni satır'
    )
    expect(plainText('Rock &amp; Roll &quot;efsane&quot; &#39;77 &lt;3')).toBe(
      'Rock & Roll "efsane" \'77 <3'
    )
  })

  it('betik / olay işleyici metne dönüşmez: yalnızca düz metin kalır', () => {
    const out = plainText('<img src=x onerror="alert(1)">Merhaba<script>alert(2)</script>')
    expect(out).not.toMatch(/<|onerror/)
    expect(out).toBe('Merhabaalert(2)')
  })

  it('kodlanmış etiket çözülür ama yeniden ayıklanmaz (React metin olarak gösterir)', () => {
    expect(plainText('&lt;b&gt;kalın&lt;/b&gt;')).toBe('<b>kalın</b>')
  })
})
