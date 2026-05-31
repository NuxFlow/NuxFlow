import type { UserConfig } from '@commitlint/types'

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 200],
  },
}

export default config
