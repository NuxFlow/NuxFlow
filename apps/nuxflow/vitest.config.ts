import { defineConfig } from 'vitest/config'

export default defineConfig({
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
