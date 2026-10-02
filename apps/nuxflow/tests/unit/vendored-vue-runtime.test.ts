import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// server/assets/vendor/vue-runtime.js is a checked-in copy of Vue's browser runtime, served
// to the sandboxed plugin iframe (Workers can't read node_modules at request time). It has
// to be refreshed by hand after a Vue bump — this fails CI when that step is missed:
//   cp node_modules/vue/dist/vue.runtime.esm-browser.prod.js server/assets/vendor/vue-runtime.js
describe('vendored Vue runtime', () => {
  it('matches the installed vue version', () => {
    const require = createRequire(import.meta.url)
    const installed = (require('vue/package.json') as { version: string }).version
    const vendored = readFileSync(new URL('../../server/assets/vendor/vue-runtime.js', import.meta.url), 'utf8')
    expect(vendored.match(/\* vue v(\S+)/)?.[1]).toBe(installed)
  })
})
