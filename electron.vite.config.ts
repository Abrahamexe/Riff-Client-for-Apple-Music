import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/main/csp'

const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  version: string
}

// index.html içindeki %CSP% yer tutucusunu moda göre doldurur.
function cspPlugin(devServer: boolean): Plugin {
  return {
    name: 'am-client-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace('%CSP%', buildCsp(devServer))
      }
    }
  }
}

// PLAN_v5 P6: debug paneli işaretlemesi yalnızca dev build'de. Prod derlemesinde index.html'deki
// `<!-- debug:start -->` … `<!-- debug:end -->` arası silinir (işaretler yoksa derleme durur:
// sessizce panel kalmasın). Panel kodu `__DEV_BUILD__` dalında dinamik import edilir.
function debugMarkupPlugin(devBuild: boolean): Plugin {
  return {
    name: 'am-client-debug-markup',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (devBuild || !ctx.filename.endsWith('index.html')) return html
        const stripped = html.replace(/<!-- debug:start -->[\s\S]*?<!-- debug:end -->/, '')
        if (stripped === html) throw new Error('index.html: debug:start/debug:end işaretleri yok')
        return stripped
      }
    }
  }
}

// Derleme zamanı bayrakları (src/shared/build-flags.d.ts). `false` olan dallar bundle'dan tamamen
// çıkar (dead-code elimination):
//  - __DEV_SERVER__: yalnızca `electron-vite dev`. Vite dev server URL'si (ELECTRON_RENDERER_URL)
//    ve localhost yalnızca bu build'de güvenilir sayılır.
//  - __DEV_BUILD__: dev server VEYA `--mode devbuild` (build:dev / pack:dev). .env / .p8 okuyan
//    DevTokenProvider ve 1.5 şifresiz kopya taraması yalnızca bu build'de vardır (PLAN 1.10).
export default defineConfig(({ command, mode }) => {
  const devServer = command === 'serve'
  const devBuild = devServer || mode === 'devbuild'
  const flags = {
    __DEV_SERVER__: JSON.stringify(devServer),
    __DEV_BUILD__: JSON.stringify(devBuild),
    __APP_VERSION__: JSON.stringify(version),
    // PLAN 4.1: production build'de zorunlu (RELEASE_CHECKLIST); yalnızca https kabul edilir.
    __TOKEN_SERVICE_URL__: JSON.stringify(process.env.AM_TOKEN_SERVICE_URL ?? '')
  }
  const alias = { '@shared': resolve('src/shared') }

  return {
    main: {
      define: flags,
      build: {
        // 2.2: zod ve jose bundle'a gömülür (tree-shaking). Worker başlangıcında `zod/mini`'nin
        // node_modules'tan onlarca dosya halinde yüklenmesi ~60 ms sürüyordu; paketli sürümde main ve
        // worker çalışma anında node_modules'a bağımlı kalmaz.
        externalizeDeps: { exclude: ['zod', 'jose'] },
        rollupOptions: {
          // worker.js: utilityProcess olarak main'den fork edilir (PLAN 1.7a).
          input: { index: resolve('src/main/index.ts'), worker: resolve('src/worker/index.ts') }
        }
      },
      resolve: { alias }
    },
    preload: {
      define: flags,
      // Sandbox'lı preload `require` ile node_modules yükleyemez: bağımlılıklar (zod) bundle'a gömülür.
      build: { externalizeDeps: false },
      resolve: { alias }
    },
    renderer: {
      plugins: [cspPlugin(devServer), debugMarkupPlugin(devBuild)],
      define: flags,
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            // B12b MiniPlayer penceresi.
            mini: resolve('src/renderer/mini.html')
          }
        }
      },
      resolve: {
        alias: { ...alias, '@core': resolve('src/renderer/core') }
      }
    }
  }
})
