import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

// PLAN 1.1a: type-aware lint. `no-floating-promises`, `no-misused-promises`, `await-thenable`,
// `no-unsafe-*` ve `no-explicit-any` recommendedTypeChecked içindedir; aşağıda sıkılaştırılır.
// Platforma özel Electron API'leri yalnızca src/main/platform/ içinde (CLAUDE.md mimari sınırlar).
const PLATFORM_ONLY_ELECTRON = [
  'Tray',
  'Menu',
  'MenuItem',
  'globalShortcut',
  'nativeImage',
  'nativeTheme',
  'powerMonitor',
  'powerSaveBlocker',
  'systemPreferences',
  'shell'
]

// Güvenlik kuralı 5: HTML/kod enjeksiyonuna açık API'ler yasak (metin için textContent, HTML
// gerekiyorsa DOMPurify).
const SECURITY_PROPERTIES = [
  {
    property: 'innerHTML',
    message: 'Güvenlik kuralı 5: innerHTML yasak; textContent kullanın.'
  },
  { property: 'outerHTML', message: 'Güvenlik kuralı 5: outerHTML yasak.' },
  { property: 'insertAdjacentHTML', message: 'Güvenlik kuralı 5: insertAdjacentHTML yasak.' },
  {
    property: 'createContextualFragment',
    message: 'Güvenlik kuralı 5: HTML ayrıştırma yasak; gerekiyorsa DOMPurify.'
  },
  {
    property: 'executeJavaScript',
    message: "Güvenlik kuralı 5: renderer'da string kod çalıştırmak yasak."
  },
  {
    object: 'document',
    property: 'write',
    message: 'Güvenlik kuralı 5: document.write yasak.'
  },
  {
    object: 'document',
    property: 'writeln',
    message: 'Güvenlik kuralı 5: document.writeln yasak.'
  }
]

export default tseslint.config(
  { ignores: ['node_modules/', 'out/', 'dist/', 'secrets/', 'docs/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    }
  },
  // Tip bilgisi olmayan dosyalar (script'ler, config'ler): type-aware kurallar kapalı.
  { files: ['**/*.{mjs,cjs,js}'], ...tseslint.configs.disableTypeChecked },
  {
    files: [
      'scripts/**/*.{mjs,cjs,js}',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/worker/**/*.ts',
      'electron.vite.config.ts',
      'vitest.config.ts',
      'tests/**/*.ts',
      'server/**/*.ts',
      'tests/e2e/**/*.{cjs,mjs}',
      '.dependency-cruiser.cjs'
    ],
    languageOptions: { globals: globals.node }
  },
  // E2E: renderer'a enjekte edilen sahte MusicKit tarayıcıda çalışır (PLAN 2.6).
  {
    files: ['tests/e2e/**/*.browser.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // no-implied-eval, string ile setTimeout/setInterval'i yakalar.
      'no-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-restricted-properties': ['error', ...SECURITY_PROPERTIES],
      // Köşeli parantezle erişim (`el['innerHTML']`) ve `Function(...)` yolları da kapalı.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[computed=true][property.value=/^(innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|executeJavaScript)$/]',
          message: "Güvenlik kuralı 5: HTML/kod enjeksiyonu API'leri yasak."
        },
        {
          selector: "CallExpression[callee.name='Function'], NewExpression[callee.name='Function']",
          message: 'Güvenlik kuralı 5: new Function yasak.'
        },
        {
          // Arayüz (React, Faz B): HTML enjeksiyonu kapısı kapalı; metin her zaman kaçışlanır.
          selector:
            "JSXAttribute[name.name='dangerouslySetInnerHTML'], Property[key.name='dangerouslySetInnerHTML']",
          message:
            'Güvenlik kuralı 5: dangerouslySetInnerHTML yasak (gerekirse DOMPurify + gerekçe).'
        }
      ]
    }
  },
  // Platforma özel kod yalnızca main/platform/ (tray, medya tuşları, pencere davranışı, yollar).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/main/platform/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              importNames: PLATFORM_ONLY_ELECTRON,
              message: "Platforma özel Electron API'leri yalnızca src/main/platform/ içinde."
            }
          ]
        }
      ],
      'no-restricted-properties': [
        'error',
        ...SECURITY_PROPERTIES,
        {
          object: 'process',
          property: 'platform',
          message: 'Platform kontrolü yalnızca src/main/platform/ içinde.'
        }
      ]
    }
  },
  // Testler: sahte nesneler için gevşetilmiş tip kuralları; floating promise yine yasak.
  {
    files: ['src/**/*.test.ts', 'src/**/testing.ts', 'src/**/*.fixtures.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off'
    }
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  prettier
)
