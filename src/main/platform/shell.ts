import { shell } from 'electron'

/**
 * Varsayılan tarayıcıda açar (PLAN_v5 P4). Çağıran adresi önceden doğrulamış olmalıdır
 * (`main/externalLinks.ts`: yalnızca sabit, https, izinli host). Burada yalnızca platform çağrısı.
 */
export function openInDefaultBrowser(url: string): Promise<void> {
  return shell.openExternal(url)
}
