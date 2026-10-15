import type { AppearanceSettings, ThemeMode } from '@shared/settings'

// Tema ve cam saydamlığı (PLAN_v5 B1). Saf hesaplar burada (testli); DOM'a uygulama `applyAppearance`.
// Değerler geliştiricinin onayına sunulur (B1 ekran görüntüsü); onaylanınca bu dosyada sabitlenir.

export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

/**
 * Saydamlık ayarı (0 = en az … 100 = en çok) → cam yüzeyin opaklığı. Uçlar bilerek sınırlı: en
 * saydamda bile metin okunur kalsın (0,30), en azda cam hissi kaybolmasın (0,92).
 */
export const GLASS_ALPHA_OPAQUE = 0.92
export const GLASS_ALPHA_CLEAR = 0.3

export function glassAlpha(transparency: number): number {
  const t = Math.min(100, Math.max(0, Number.isFinite(transparency) ? transparency : 0)) / 100
  return Number((GLASS_ALPHA_OPAQUE - t * (GLASS_ALPHA_OPAQUE - GLASS_ALPHA_CLEAR)).toFixed(3))
}

/** Kök öğeye tema ve cam değişkenlerini yazar (CSS `tokens.css` bunları kullanır). */
export function applyAppearance(
  root: HTMLElement,
  appearance: AppearanceSettings,
  systemPrefersDark: boolean,
  /** İnce ayar: bulanıklık kapalıyken cam en az `minAlpha` opak (tweaks.ts NO_BLUR_MIN_ALPHA). */
  minAlpha = 0
): ResolvedTheme {
  const theme = resolveTheme(appearance.theme, systemPrefersDark)
  root.dataset['theme'] = theme
  root.style.setProperty(
    '--glass-alpha',
    String(Math.max(minAlpha, glassAlpha(appearance.transparency)))
  )
  root.style.colorScheme = theme
  return theme
}
