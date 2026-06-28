// Copies argon2.wasm from argon2-browser dist into src/ so Wrangler can
// bundle it as a static WebAssembly.Module via the ES module import in index.ts.
const { copyFileSync } = require('node:fs')
const { resolve } = require('node:path')

const src = resolve(__dirname, '../node_modules/argon2-browser/dist/argon2.wasm')
const dest = resolve(__dirname, '../src/argon2.wasm')

try {
  copyFileSync(src, dest)
  console.log('✓ argon2.wasm copied to src/')
}
catch {
  console.error('✗ Could not copy argon2.wasm — run `pnpm install` inside workers/argon2-hasher/ first')
  process.exit(1)
}
