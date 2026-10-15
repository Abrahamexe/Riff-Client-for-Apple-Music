import { I18n } from '@shared/i18n'

// Renderer'ın i18n örneği (PLAN 1.3b). Dil: sistem dili Türkçe ise `tr`, değilse `en`
// (`navigator.languages` Chromium'un uygulama dilini yansıtır). Tercih `setPreference` ile değişir;
// kalıcı ayar Faz 3 (Ayarlar) kapsamındadır.
export const i18n = new I18n(typeof navigator === 'undefined' ? [] : navigator.languages)
