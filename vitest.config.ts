import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@core': resolve('src/renderer/core')
    }
  },
  // Derleme zamanı bayrakları (src/shared/build-flags.d.ts): testler dev build davranışını görür.
  define: {
    __DEV_SERVER__: 'false',
    __DEV_BUILD__: 'true',
    __APP_VERSION__: '"0.0.0-test"',
    __TOKEN_SERVICE_URL__: '""'
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts', 'server/**/*.test.ts'],
    // PLAN 2.6: core/ ve worker/ satır kapsamı ≥ %80 (`npm run test:coverage`; 2026-10-12: %93,6).
    coverage: {
      provider: 'v8',
      include: ['src/renderer/core/**', 'src/worker/**'],
      exclude: ['**/*.test.ts', '**/*.fixtures.ts', '**/testing.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 80 }
    }
  }
})
