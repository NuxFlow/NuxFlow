import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      // Nuxt's alias for shared/ — app code must use it (a relative import of shared/lib
      // from app/utils breaks the production build).
      '#shared': resolve(import.meta.dirname, 'shared'),
    },
  },
  test: {
    name: 'unit',
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage/unit',
      include: ['server/**', 'app/**/*.ts', '../../packages/*/src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', 'tests/**', '**/*.d.ts'],
    },
  },
})
