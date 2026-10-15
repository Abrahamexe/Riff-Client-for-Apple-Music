import type { LyricsSize, MotionMode, TweaksSettings } from '@shared/settings'

// İnce ayar (2026-10-14): kök öğeye uygulanan kısımlar. Saf hesaplar burada (testli).
//  - Animasyonlar: Motion `reducedMotion` + "azalt" seçiliyken CSS geçiş/animasyonları da kısalır
//    (`tw-reduced-motion`; CSS'teki `prefers-reduced-motion` yalnızca Windows ayarını görür).
//  - Cam bulanıklığı kapalı: `backdrop-filter` yok (`tw-no-blur`), cam yüzeyler daha opak.
//  - Söz yazı boyutu: `--lyrics-scale`.

const LYRICS_SCALE: Record<LyricsSize, number> = { small: 0.8, medium: 1, large: 1.25 }
/** Bulanıklık kapalıyken camın en az opaklığı (arkası net görünüp metni boğmasın). */
export const NO_BLUR_MIN_ALPHA = 0.96

/** Motion `MotionConfig.reducedMotion` değeri. */
export function motionConfigMode(mode: MotionMode): 'user' | 'always' | 'never' {
  return mode === 'reduced' ? 'always' : mode === 'full' ? 'never' : 'user'
}

export interface RootLike {
  classList: { toggle(name: string, force: boolean): unknown }
  style: { setProperty(name: string, value: string): void }
}

export function applyTweaks(root: RootLike, tweaks: TweaksSettings): void {
  root.classList.toggle('tw-reduced-motion', tweaks.motion === 'reduced')
  root.classList.toggle('tw-no-blur', !tweaks.glassBlur)
  root.style.setProperty('--lyrics-scale', String(LYRICS_SCALE[tweaks.lyricsSize]))
}

/** Bir adım ses değişikliği (0..1, iki ondalık); `step` yüzde. */
export function stepVolume(volume: number, step: number, up: boolean): number {
  const next = Math.round((volume + (up ? step : -step) / 100) * 100) / 100
  return Math.min(1, Math.max(0, next))
}
