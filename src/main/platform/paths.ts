import { join } from 'node:path'

// Uygulama yolları tek yerde (CLAUDE.md: yollar yalnızca main/platform/). Kullanıcı verisi
// `userData` altındadır; çıkışta silinecek dosyalar (PLAN 2.5 PRIVACY) buradan listelenir.

/** Electron `app`'in kullandığımız yüzeyi. */
export interface AppPathSource {
  getPath(name: 'userData' | 'downloads' | 'crashDumps'): string
  getAppPath(): string
  readonly isPackaged: boolean
}

export interface AppPaths {
  userData: string
  /** Worker'ın SQLite veritabanı (cache; silinip Apple'dan yeniden oluşturulabilir). */
  libraryDb: string
  /** safeStorage ile şifreli Music User Token. */
  authFile: string
  /** Kapak görseli disk önbelleği (2.2); çıkışta silinir. */
  artworkCache: string
  /** Maskeli log dosyaları (2.3, tanılama paketi). */
  logs: string
  /** Yerel çökme dökümleri (crashReporter, yüklenmez); çıkışta silinir. */
  crashDumps: string
  /** Tanılama paketinin yazıldığı İndirilenler klasörü. */
  downloads: string
  /** Derlenmiş renderer klasörü (app:// protokolünün kökü). */
  rendererRoot: string
  preload: string
  workerScript: string
}

/** `mainDir`: derlenmiş main bundle'ının klasörü (`__dirname`). */
export function resolveAppPaths(app: AppPathSource, mainDir: string): AppPaths {
  const userData = app.getPath('userData')
  return {
    userData,
    libraryDb: join(userData, 'library.db'),
    authFile: join(userData, 'auth.bin'),
    artworkCache: join(userData, 'artwork'),
    logs: join(userData, 'logs'),
    crashDumps: app.getPath('crashDumps'),
    downloads: app.getPath('downloads'),
    rendererRoot: join(mainDir, '../renderer'),
    preload: join(mainDir, '../preload/index.js'),
    workerScript: join(mainDir, 'worker.js')
  }
}
