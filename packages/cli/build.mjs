// Bundles the NuxFlow CLI into a single runnable Node.js ESM file.
// Run with: node build.mjs  (or via `pnpm build` in this package)
//
// esbuild is already a dependency (used by buildPlugin), so we reuse it here.

import { build } from 'esbuild'
import { chmod } from 'fs/promises'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  // CJS is required here: fs-extra / graceful-fs use dynamic require() internally.
  // Bundling them into ESM breaks those require calls; CJS handles them correctly.
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  // .cjs extension tells Node.js to treat this as CommonJS regardless of package.json "type".
  outfile: 'bin/nuxflow.cjs',
  // Shebang so the file is directly executable on Unix/macOS.
  // On Windows, pnpm creates a .cmd / .ps1 wrapper that calls node explicitly.
  banner: { js: '#!/usr/bin/env node' },
  // esbuild must NOT be bundled — it ships native binaries (.node files).
  external: ['esbuild'],
})

// Make executable on Unix-like systems — no-op on Windows.
await chmod('bin/nuxflow.cjs', 0o755).catch(() => {})

console.log('Built → bin/nuxflow.cjs')
