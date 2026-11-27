import type { AppearanceSettings, ThemeMode } from '@shared/settings'

// Tema (PLAN_v5 B1; 2026-11-27: tek tasarım, cam saydamlığı kalktı). Saf hesaplar burada (testli);
// DOM'a uygulama `applyAppearance`.

export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

/** Kök öğeye temayı yazar (CSS `:root[data-theme]`). */
export function applyAppearance(
  root: HTMLElement,
  appearance: AppearanceSettings,
  systemPrefersDark: boolean
): ResolvedTheme {
  const theme = resolveTheme(appearance.theme, systemPrefersDark)
  root.dataset['theme'] = theme
  root.style.colorScheme = theme
  return theme
}
