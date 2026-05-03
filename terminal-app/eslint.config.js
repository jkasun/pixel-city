/**
 * Minimal ESLint flat config for the bulkhead / observability enforcement layer.
 *
 * This config exists ONLY to host the local `no-silent-promise-catch` rule
 * (Step 9 of the bulkhead plan). It is deliberately scoped to
 * `src/renderer/**` so it does not touch the rest of the monorepo.
 *
 * To run:
 *   pnpm exec eslint src/renderer/main.tsx
 *   pnpm run lint:bulkhead
 *
 * Required peer deps (NOT installed by default — install when you wire CI):
 *   - eslint
 *   - @typescript-eslint/parser   (only needed for .ts/.tsx files)
 *
 * If `@typescript-eslint/parser` is missing, this config still loads but only
 * the .js subset of the codebase will be linted. Run `pnpm add -D eslint
 * @typescript-eslint/parser` to enable TS coverage.
 */
const noSilentPromiseCatch = require('./eslint-rules/no-silent-promise-catch.js')

let tsParser = null
try {
  // Optional: only present if the user has run `pnpm add -D @typescript-eslint/parser`.
  // Loaded via require() so the config still evaluates if the parser is missing.
  tsParser = require('@typescript-eslint/parser')
} catch {
  tsParser = null
}

const localPlugin = {
  rules: {
    'no-silent-promise-catch': noSilentPromiseCatch,
  },
}

const config = [
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...(tsParser
      ? {
          languageOptions: {
            parser: tsParser,
            parserOptions: {
              ecmaVersion: 2022,
              sourceType: 'module',
              ecmaFeatures: { jsx: true },
            },
          },
        }
      : {}),
    plugins: {
      local: localPlugin,
    },
    rules: {
      // Severity is `warn`, NOT `error` — legacy hits exist; don't break CI on Day 1.
      'local/no-silent-promise-catch': 'warn',
    },
  },
  {
    files: ['src/renderer/**/*.{js,jsx,mjs,cjs}'],
    plugins: {
      local: localPlugin,
    },
    rules: {
      'local/no-silent-promise-catch': 'warn',
    },
  },
  {
    // Don't lint generated/vendor code or the rule itself.
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      'eslint-rules/**',
      'tests/**',
    ],
  },
]

module.exports = config
