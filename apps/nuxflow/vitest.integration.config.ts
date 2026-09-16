import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@nuxflow/db/schema': resolve(import.meta.dirname, '../../packages/db/src/schema/index.ts'),
      '@nuxflow/db/queries': resolve(import.meta.dirname, '../../packages/db/src/queries/index.ts'),
      '@nuxflow/db': resolve(import.meta.dirname, '../../packages/db/src/index.ts'),
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
  },
})
