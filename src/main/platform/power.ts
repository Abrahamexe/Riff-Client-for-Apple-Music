import { powerMonitor } from 'electron'

// Uyku / uyanma (PLAN 2.3). Uyanınca pencerelere bildirilir: renderer ağı, kütüphane senkronunu,
// developer token'ı ve MusicKit'i yeniden denetler (renderer/core/system.ts).

/** Electron `powerMonitor`'ün kullandığımız yüzeyi (testte sahte nesne). */
export interface PowerSource {
  on(event: 'resume', listener: () => void): unknown
}

export function watchSystemResume(onResume: () => void, power: PowerSource = powerMonitor): void {
  power.on('resume', () => {
    console.info('[power] sistem uyandı')
    onResume()
  })
}
