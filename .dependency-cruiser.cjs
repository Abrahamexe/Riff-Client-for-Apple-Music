// Mimari sınır denetimi (PLAN 1.1a, CLAUDE.md "Mimari sınırlar"). `npm run depcruise` ve
// `npm run check` içinde koşar; ihlal build'i kırar. Tip import'ları da sayılır (tsPreCompilationDeps).
//
// Süreçler (main · preload · renderer · worker) birbirini import etmez; ortak tip ve şemalar
// yalnızca src/shared/. Platforma özel Electron API'leri ESLint (no-restricted-imports) ile denetlenir.

const PROCESSES = ['main', 'preload', 'renderer', 'worker']

/** Bir sürecin diğer süreçleri import etmesini yasaklayan kurallar. */
const processRules = PROCESSES.map((from) => ({
  name: `no-${from}-to-other-process`,
  comment: `${from} başka bir sürecin kodunu import edemez; ortak kod yalnızca src/shared/.`,
  severity: 'error',
  from: { path: `^src/${from}/` },
  to: { path: `^src/(${PROCESSES.filter((p) => p !== from).join('|')})/` }
}))

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    ...processRules,
    {
      name: 'shared-is-leaf',
      comment:
        'shared/ hiçbir sürece bağımlı olamaz ve Node/Electron içeremez (renderer da kullanır).',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: {
        pathNot: ['^src/shared/', '^node_modules/zod/'],
        dependencyTypesNot: ['type-only']
      }
    },
    {
      name: 'shared-no-process-types',
      comment: 'shared/ süreç kodundan tip bile almaz.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/(main|preload|renderer|worker)/' }
    },
    {
      name: 'renderer-core-no-ui',
      comment:
        'renderer/core/ UI koduna (debug/, ileride ui/) ve renderer köküne (window.api köprüleri) bağımlı olamaz.',
      severity: 'error',
      from: { path: '^src/renderer/core/' },
      to: { path: '^src/renderer/', pathNot: '^src/renderer/core/' }
    },
    {
      name: 'renderer-no-node',
      comment: "Renderer sandbox'ta çalışır: Node yerleşik modülleri ve electron import edilemez.",
      severity: 'error',
      from: { path: '^src/(renderer|shared)/' },
      to: { dependencyTypes: ['core'] }
    },
    {
      name: 'renderer-no-electron',
      comment: "Renderer/shared electron'u import edemez (preload'daki dar API kullanılır).",
      severity: 'error',
      from: { path: '^src/(renderer|shared)/' },
      to: { path: '^node_modules/electron/' }
    },
    {
      name: 'platform-only-from-main',
      comment: 'main/platform/ yalnızca main tarafından kullanılır.',
      severity: 'error',
      from: { pathNot: '^src/main/' },
      to: { path: '^src/main/platform/' }
    },
    {
      name: 'no-test-code-in-production',
      comment:
        'Üretim kodu test dosyalarını, test yardımcılarını ve MSW fixture’larını import edemez.',
      severity: 'error',
      from: { path: '^src/', pathNot: ['\\.test\\.tsx?$', '/testing\\.ts$', '\\.fixtures\\.ts$'] },
      to: {
        path: [
          '\\.test\\.tsx?$',
          '/testing\\.ts$',
          '\\.fixtures\\.ts$',
          '^node_modules/(vitest|msw)/'
        ]
      }
    },
    {
      name: 'no-circular',
      comment: 'Döngüsel bağımlılık yasak.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Çözümlenemeyen import (yanlış yol veya eksik paket).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.d\\.ts$' },
    tsPreCompilationDeps: true,
    // tsconfig.web.json iki alias'ı da (@shared, @core) tanımlar.
    tsConfig: { fileName: 'tsconfig.web.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings']
    }
  }
}
