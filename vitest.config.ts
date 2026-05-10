import { defineConfig } from 'vitest/config'

// Root config delegates to each package's own vitest config.
// Run all tests:  npx vitest run
// Run app tests:  cd apps/nuxflow && npx vitest run
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'apps/nuxflow',
      'packages/db',
      'packages/plugin-sdk',
      'packages/cli',
    ],
  },
})
