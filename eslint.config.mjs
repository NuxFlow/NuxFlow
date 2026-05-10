import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  features: {
    tooling: true,
    stylistic: false,
  },
  dirs: {
    src: ['./apps/nuxflow'],
  },
}).append(
  { ignores: ['apps/nuxflow/server/stubs/**'] },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: [
      'apps/nuxflow/app/pages/**/*.vue',
      'apps/nuxflow/app/layouts/**/*.vue',
      'apps/nuxflow/app/components/**/*.vue',
    ],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
)
