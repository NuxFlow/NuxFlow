import { build } from 'esbuild'
import { readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { computeSha256 } from './signing'

export interface BuildResult {
  serverModule?: string    // base64-encoded ESM for Cloudflare Workers
  serverChecksum?: string  // SHA-256 hex of raw server code
  clientBundle?: string    // base64-encoded ESM for browser
  clientChecksum?: string  // SHA-256 hex of raw client bundle
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

export async function buildPlugin(pluginDir: string): Promise<BuildResult> {
  const distDir = join(pluginDir, 'dist')
  await mkdir(distDir, { recursive: true })

  const [server, client] = await Promise.all([
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
  ])

  return {
    ...(server ? { serverModule: server.b64, serverChecksum: server.checksum } : {}),
    ...(client ? { clientBundle: client.b64, clientChecksum: client.checksum } : {}),
  }
}
