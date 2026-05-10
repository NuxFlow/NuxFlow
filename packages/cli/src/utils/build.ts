import { build } from 'esbuild'
import { readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

interface BuildResult {
  serverModule?: string  // base64-encoded ESM for Cloudflare Workers
  clientBundle?: string  // base64-encoded ESM for browser
}

async function tryBuild(entryPoint: string, outfile: string, platform: 'neutral' | 'browser', target: string): Promise<string | undefined> {
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
  return Buffer.from(code).toString('base64')
}

export async function buildPlugin(pluginDir: string): Promise<BuildResult> {
  const distDir = join(pluginDir, 'dist')
  await mkdir(distDir, { recursive: true })

  const [serverModule, clientBundle] = await Promise.all([
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

  return { serverModule, clientBundle }
}
