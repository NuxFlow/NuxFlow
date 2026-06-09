import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@nuxflow/db/schema': resolve(__dirname, '../../packages/db/src/schema/index.ts'),
      '@nuxflow/db': resolve(__dirname, '../../packages/db/src/index.ts'),
    },
  },
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    // Sequential execution prevents port / temp-file conflicts between suites
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/helpers/globals.ts'],
    testTimeout: 30_000,
  },
})
