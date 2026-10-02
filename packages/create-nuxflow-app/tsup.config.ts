import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'bin',
  format: ['esm'],
  target: 'node20',
  clean: true,
  shims: true,
  define: {
    __NUXFLOW_VERSION__: JSON.stringify(version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
})
