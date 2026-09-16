import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { computeSha256 } from './signing'

export interface BuildResult {
  serverModule?: string    // base64-encoded ESM for Cloudflare Workers
  serverChecksum?: string  // SHA-256 hex of raw server code
  clientBundle?: string    // base64-encoded ESM for browser
  clientChecksum?: string  // SHA-256 hex of raw client bundle
  // base64-encoded raw text of src/blocks.json, verbatim (not re-serialized) — the
  // checksum must cover the exact bytes shipped so the server can recompute the same
  // value after base64-decoding, the same contract serverModule/clientBundle use.
  blockDefinitions?: string
  definitionsChecksum?: string  // SHA-256 hex of the raw (pre-base64) blocks.json text
}

async function tryBuild(entryPoint: string, outfile: string, platform: 'neutral' | 'browser', target: string): Promise<{ b64: string; checksum: string } | undefined> {
  if (!existsSync(entryPoint)) return undefined

  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform,
    target,
    outfile,
    // No externals — the server module must be fully self-contained.
    // The client module receives Vue via the register() argument, so it
    // never needs to import 'vue' as a bare specifier.
    minify: platform === 'browser',
    treeShaking: true,
  })

  const code = await readFile(outfile, 'utf-8')
  const [b64, checksum] = await Promise.all([
    Promise.resolve(Buffer.from(code).toString('base64')),
    computeSha256(code),
  ])
  return { b64, checksum }
}

// blocks.json is plain data, never executed — read and checksummed as-is, no esbuild
// pass needed. Still validated as parseable JSON so a malformed file fails the build
// immediately rather than surfacing as a confusing server-side install error later.
async function readBlockDefinitions(pluginDir: string): Promise<{ b64: string; checksum: string } | undefined> {
  const entryPoint = join(pluginDir, 'src/blocks.json')
  if (!existsSync(entryPoint)) return undefined

  const text = await readFile(entryPoint, 'utf-8')
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('src/blocks.json must contain a JSON array')
  } catch (err) {
    throw new Error(`src/blocks.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  const [b64, checksum] = await Promise.all([
    Promise.resolve(Buffer.from(text).toString('base64')),
    computeSha256(text),
  ])
  return { b64, checksum }
}

export async function buildPlugin(pluginDir: string): Promise<BuildResult> {
  const distDir = join(pluginDir, 'dist')
  await mkdir(distDir, { recursive: true })

  const [server, client, definitions] = await Promise.all([
    tryBuild(
      join(pluginDir, 'src/server.ts'),
      join(distDir, 'server.js'),
      'neutral',   // Cloudflare Workers: no Node or browser globals assumed
      'es2022',
    ),
    tryBuild(
      join(pluginDir, 'src/client.ts'),
      join(distDir, 'client.js'),
      'browser',
      'es2020',
    ),
    readBlockDefinitions(pluginDir),
  ])

  return {
    ...(server ? { serverModule: server.b64, serverChecksum: server.checksum } : {}),
    ...(client ? { clientBundle: client.b64, clientChecksum: client.checksum } : {}),
    ...(definitions ? { blockDefinitions: definitions.b64, definitionsChecksum: definitions.checksum } : {}),
  }
}
