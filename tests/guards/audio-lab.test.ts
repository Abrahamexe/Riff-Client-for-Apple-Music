import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Ses Laboratuvarı (2026-10-30, CHECKPOINT §6.33) değişmez kuralı: çözülmüş (DRM'siz) ses ASLA diske,
// IPC'ye, worker'a ya da ağa gitmez; yalnızca renderer belleğinde, çalma yolunda işlenir. Kayıt / dışa
// aktarma yoktur (DRM'i aşmak olur). Kaynak metin denetimi.

const ROOT = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = join(dir, name)
    return statSync(join(ROOT, p)).isDirectory() ? files(p) : [p]
  })
}

/** Yorumları çıkarır (açıklamalarda bu sözcükler geçebilir). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('Ses Laboratuvarı: ses dışarı çıkmaz', () => {
  const lab = files('src/renderer/core/audio/lab').filter((f) => !f.endsWith('.test.ts'))

  it('işlemci ve DSP mesaj, ağ ya da depolama kullanmaz', () => {
    expect(lab.length).toBeGreaterThanOrEqual(4)
    for (const f of lab) {
      const src = code(read(f))
      for (const banned of [
        'postMessage',
        '.port',
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'localStorage',
        'indexedDB',
        'window.api'
      ]) {
        expect(src, `${relative(ROOT, f)}: ${banned}`).not.toContain(banned)
      }
    }
  })

  it('renderer hiçbir yerde sesi kaydedecek ya da akıtacak API kullanmaz', () => {
    const renderer = files('src/renderer').filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
    for (const f of renderer) {
      const src = code(read(f))
      for (const banned of [
        'MediaRecorder',
        'captureStream',
        'createMediaStreamDestination',
        'OfflineAudioContext',
        'createScriptProcessor'
      ]) {
        expect(src, `${relative(ROOT, f)}: ${banned}`).not.toContain(banned)
      }
    }
  })
})
