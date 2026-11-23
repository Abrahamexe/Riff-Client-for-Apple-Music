// Derleme zamanı bayrakları: electron.vite.config.ts `define` ile sabit `true`/`false` olarak
// yerleştirilir; `false` dallar production bundle'ından tamamen çıkar. Testlerde vitest.config.ts tanımlar.

/** Yalnızca `electron-vite dev` (Vite dev server). */
declare const __DEV_SERVER__: boolean

/** Dev server veya `--mode devbuild`: .env/.p8 okuma ve geliştirici araçları yalnızca burada. */
declare const __DEV_BUILD__: boolean

/** package.json'daki sürüm (renderer ve main/worker build'ine enjekte edilir; User-Agent'ta kullanılır). */
declare const __APP_VERSION__: string

/**
 * Developer token servisinin adresi (PLAN 4.1): derleme sırasında `AM_TOKEN_SERVICE_URL` ortam
 * değişkeninden. Boşsa uzak sağlayıcı yok (dev build `.env`, production "sağlayıcı yok").
 * Gizli değildir (istemcide görünür); `.p8` yalnızca sunucudadır.
 */
declare const __TOKEN_SERVICE_URL__: string
