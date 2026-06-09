import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'unit',
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.nuxt/**', 'tests/e2e/**'],
    },
  },
})
