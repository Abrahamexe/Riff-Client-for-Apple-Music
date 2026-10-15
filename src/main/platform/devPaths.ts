import { join } from 'node:path'
import type { AppPathSource } from './paths'

// YALNIZCA DEV BUILD: bu modül yalnızca token/devToken.ts'ten (dinamik import edilen dev dalı)
// kullanılır; production bundle'ına girmez (scripts/verify-prod-bundle.mjs).

/** Dev: proje kökündeki .env; paketli dev build: userData/.env (installer'a GİRMEZ). */
export function devEnvFilePath(app: AppPathSource): string {
  return app.isPackaged ? join(app.getPath('userData'), '.env') : join(app.getAppPath(), '.env')
}
