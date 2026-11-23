import { nativeImage, nativeTheme, type NativeImage, type ThumbarButton } from 'electron'
import type { PlayerCommand, PlayerHubState } from '@shared/ipc-contract'
import type { I18n } from '@shared/i18n'
import { THUMBAR_PNG, type ThumbarGlyph, type ThumbarTone } from './thumbarIcons'

// Görev çubuğu küçük resim düğmeleri (2026-11-02, geliştirici seçimi): pencerenin görev çubuğu
// önizlemesinde önceki / çal-duraklat / sonraki (Apple Music ve Spotify gibi). Yalnızca Windows.
// Durum player-hub'dan gelir; komutlar tray gibi hub'a gider. Glif rengi görev çubuğu temasına göre
// (koyu çubukta açık glif); tema değişince yenilenir.

/** Düğmeyi çizmeye yetecek bilgi (Electron'dan bağımsız, testli). */
export interface ThumbarButtonSpec {
  glyph: ThumbarGlyph
  tooltip: string
  enabled: boolean
  command: PlayerCommand
}

/** Bu durumlarda çal düğmesi "duraklat" gösterir (bekleyen şarkı da çalıyor sayılır, oynatıcıyla aynı). */
const ACTIVE_STATES: ReadonlySet<PlayerHubState['playbackState']> = new Set([
  'playing',
  'loading',
  'waiting',
  'stalled'
])

export function thumbarSpec(i18n: I18n, state: PlayerHubState | null): ThumbarButtonSpec[] {
  const hasTrack = state?.nowPlaying != null
  const playing = state !== null && ACTIVE_STATES.has(state.playbackState)
  return [
    {
      glyph: 'previous',
      tooltip: i18n.t('player.previous'),
      enabled: hasTrack,
      command: { type: 'previous' }
    },
    {
      glyph: playing ? 'pause' : 'play',
      tooltip: i18n.t(playing ? 'player.pause' : 'player.play'),
      enabled: hasTrack,
      command: { type: 'togglePlay' }
    },
    { glyph: 'next', tooltip: i18n.t('player.next'), enabled: hasTrack, command: { type: 'next' } }
  ]
}

/** Koyu görev çubuğunda açık glif, açıkta koyu. */
export function thumbarTone(darkTaskbar: boolean): ThumbarTone {
  return darkTaskbar ? 'light' : 'dark'
}

/** Aynı görünümü tekrar Windows'a göndermemek için anahtar (durum yayını sık: kuyruk, ses…). */
export function thumbarKey(spec: readonly ThumbarButtonSpec[], tone: ThumbarTone): string {
  return `${tone}|${spec.map((b) => `${b.glyph}:${b.enabled ? 1 : 0}:${b.tooltip}`).join('|')}`
}

const imageCache = new Map<string, NativeImage>()

/** %100 / %150 / %200 ekran ölçeği temsilleri; Windows uygun olanı seçer. */
function glyphImage(tone: ThumbarTone, glyph: ThumbarGlyph): NativeImage {
  const key = `${tone}:${glyph}`
  const cached = imageCache.get(key)
  if (cached) return cached
  const png = THUMBAR_PNG[tone][glyph]
  const url = (size: number): string => `data:image/png;base64,${png[size]}`
  const image = nativeImage.createFromDataURL(url(16))
  image.addRepresentation({ scaleFactor: 1.5, width: 24, height: 24, dataURL: url(24) })
  image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, dataURL: url(32) })
  imageCache.set(key, image)
  return image
}

/** Kullandığımız `BrowserWindow` yüzeyi. */
export interface ThumbarWindow {
  setThumbarButtons(buttons: ThumbarButton[]): boolean
  isDestroyed(): boolean
  on(event: 'show', listener: () => void): unknown
}

export interface ThumbarSource {
  snapshot(): { state: PlayerHubState | null }
  onState(listener: (state: PlayerHubState | null) => void): () => void
}

/**
 * Düğmeleri kurar ve durumla günceller. Pencere gösterilmeden Windows düğmeleri kabul etmeyebilir:
 * her `show`'da yeniden gönderilir. Döndürülen fonksiyon dinleyicileri kaldırır.
 */
export function setupThumbar(
  win: ThumbarWindow,
  i18n: I18n,
  source: ThumbarSource,
  command: (command: PlayerCommand) => void
): () => void {
  if (process.platform !== 'win32') return () => {}
  let state = source.snapshot().state
  let lastKey = ''
  const apply = (force = false): void => {
    if (win.isDestroyed()) return
    const spec = thumbarSpec(i18n, state)
    const tone = thumbarTone(nativeTheme.shouldUseDarkColorsForSystemIntegratedUI)
    const key = thumbarKey(spec, tone)
    if (!force && key === lastKey) return
    const ok = win.setThumbarButtons(
      spec.map((b) => ({
        icon: glyphImage(tone, b.glyph),
        tooltip: b.tooltip,
        flags: b.enabled ? [] : ['disabled'],
        click: () => command(b.command)
      }))
    )
    lastKey = ok ? key : ''
  }
  win.on('show', () => apply(true))
  const offState = source.onState((s) => {
    state = s
    apply()
  })
  const offLocale = i18n.onChange(() => apply())
  const onTheme = (): void => apply()
  nativeTheme.on('updated', onTheme)
  return () => {
    offState()
    offLocale()
    nativeTheme.off('updated', onTheme)
  }
}
