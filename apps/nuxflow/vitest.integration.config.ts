import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@nuxflow/db/schema': resolve(import.meta.dirname, '../../packages/db/src/schema/index.ts'),
      '@nuxflow/db/queries': resolve(import.meta.dirname, '../../packages/db/src/queries/index.ts'),
      '@nuxflow/db/roles': resolve(import.meta.dirname, '../../packages/db/src/roles.ts'),
      '@nuxflow/db': resolve(import.meta.dirname, '../../packages/db/src/index.ts'),
      // Nuxt's alias for shared/ — app code must use it (a relative import of shared/lib
      // from app/utils breaks the production build).
      '#shared': resolve(import.meta.dirname, 'shared'),
    },
  },
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    // Sequential execution prevents port / temp-file conflicts between suites
    pool: 'forks',
    maxWorkers: 1,
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/helpers/globals.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage/integration',
      include: ['server/**'],
      exclude: ['**/*.d.ts', 'server/assets/**', 'server/stubs/**'],
    },
  },
})
