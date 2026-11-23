import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance, type SingleInstanceApp } from './single-instance'

/** İki süreç arasında paylaşılan kilit (Electron'da userData'ya bağlı işletim sistemi kilidi). */
function fakeLockServer() {
  let holder: { listeners: (() => void)[] } | null = null
  const newProcess = () => {
    const proc = {
      quit: vi.fn(),
      listeners: [] as (() => void)[],
      requestSingleInstanceLock: (): boolean => {
        if (holder && holder !== proc) {
          // Electron: kilidi tutan örneğe `second-instance` olayı gider.
          holder.listeners.forEach((fn) => fn())
          return false
        }
        holder = proc
        return true
      },
      on: (_event: 'second-instance', listener: () => void) => void proc.listeners.push(listener)
    }
    return proc satisfies SingleInstanceApp
  }
  return { newProcess }
}

describe('tek örnek kilidi (1.8c)', () => {
  it('ilk açılış kilidi alır; ikinci açılış hemen çıkar ve mevcut pencere gösterilir', () => {
    const os = fakeLockServer()
    const first = os.newProcess()
    const showFirst = vi.fn()
    expect(acquireSingleInstance(first, showFirst)).toBe(true)
    expect(first.quit).not.toHaveBeenCalled()

    const second = os.newProcess()
    const showSecond = vi.fn()
    expect(acquireSingleInstance(second, showSecond)).toBe(false)
    // İkinci süreç çıkar ve kendi `second-instance` dinleyicisini bile kaydetmez.
    expect(second.quit).toHaveBeenCalledTimes(1)
    expect(second.listeners).toHaveLength(0)
    expect(showSecond).not.toHaveBeenCalled()
    // Birinci süreç ana penceresini gösterir.
    expect(showFirst).toHaveBeenCalledTimes(1)

    // Üçüncü açılış da aynı şekilde.
    expect(acquireSingleInstance(os.newProcess(), vi.fn())).toBe(false)
    expect(showFirst).toHaveBeenCalledTimes(2)
  })

  it('index.ts: kilit her şeyden önce alınır; DB/token/worker işleri yalnızca birincil örnekte', () => {
    const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const lock = src.indexOf('acquireSingleInstance(app')
    expect(lock).toBeGreaterThan(0)
    // Kilit, şema kaydı ve pencere/oturum kurulumundan önce.
    expect(lock).toBeLessThan(src.indexOf('registerAppScheme()'))
    // Başlatma (worker, SecureStore, IPC) yalnızca `isPrimaryInstance` dalında çağrılır.
    const start = src.indexOf('async function startPrimaryInstance')
    for (const marker of [
      'new SecureStore(',
      'startWorker(tokenProvider)',
      'registerIpcHandlers('
    ]) {
      expect(src.indexOf(marker), marker).toBeGreaterThan(start)
    }
    expect(src).toMatch(/if \(isPrimaryInstance\) \{\s*startPrimaryInstance\(\)/)
    expect(src.match(/startPrimaryInstance\(\)\./g)).toHaveLength(1)
  })
})
