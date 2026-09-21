import { defineCommand } from 'citty'
import { intro, text, confirm, outro, spinner } from '@clack/prompts'
import { consola } from 'consola'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { zipSync } from 'fflate'
import { apiPost, apiPatch, apiPostZip, authenticateOrExit, AUTH_ARGS } from '../utils/api'
import { scaffoldTheme } from '../utils/scaffold'
import { readManifest as readManifestFile, orExit } from '../utils/manifest'

interface ThemeManifest {
  name: string
  version: string
  deployedId?: string
}

interface DeployResponse {
  id?: string
  hasDemoContent?: boolean
  failedImages?: string[]
}

function readManifest(dir: string): Promise<ThemeManifest> {
  return readManifestFile<ThemeManifest>(dir, 'nuxflow.theme.json', 'theme')
}

async function readCss(dir: string): Promise<string> {
  const p = join(dir, 'theme.css')
  if (!existsSync(p)) throw new Error('theme.css not found — run this command from a theme directory')
  return readFile(p, 'utf-8')
}

// A theme becomes a "bundled" (zip) deploy the moment it carries demo content —
// bare CSS themes stay on the plain JSON path the API also supports.
async function buildBundleZip(dir: string, manifest: ThemeManifest, css: string): Promise<Uint8Array | null> {
  const demoPath = join(dir, 'demo.json')
  const imagesDir = join(dir, 'images')
  const hasDemo = existsSync(demoPath)
  const hasImages = existsSync(imagesDir)
  if (!hasDemo && !hasImages) return null

  const files: Record<string, Uint8Array> = {
    'theme.css': new TextEncoder().encode(css),
    'theme.json': new TextEncoder().encode(JSON.stringify({ name: manifest.name, version: manifest.version }, null, 2)),
  }

  if (hasDemo) {
    files['demo.json'] = new TextEncoder().encode(await readFile(demoPath, 'utf-8'))
  }

  if (hasImages) {
    for (const entry of await readdir(imagesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      files[`images/${entry.name}`] = await readFile(join(imagesDir, entry.name))
    }
  }

  return zipSync(files)
}

export const themeCommand = defineCommand({
  meta: { description: 'Manage NuxFlow CSS themes' },
  subCommands: {

    // ── nuxflow theme create ────────────────────────────────────────────────
    create: defineCommand({
      meta: { description: 'Scaffold a new CSS theme project' },
      async run() {
        intro('NuxFlow — Create Theme')

        const rawName = await text({ message: 'Theme name:', placeholder: 'my-theme' })
        if (!rawName || typeof rawName !== 'string') { outro('Cancelled'); return }

        const name = rawName.trim()
        const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        const outDir = resolve(process.cwd(), slug)

        if (existsSync(outDir)) {
          consola.error(`Directory already exists: ${outDir}`)
          process.exit(1)
        }

        const ok = await confirm({ message: `Create theme "${name}" in ./${slug}/` })
        if (!ok) { outro('Cancelled'); return }

        const s = spinner()
        s.start('Generating theme files…')
        await scaffoldTheme(outDir, name)
        s.stop('Theme files created.')

        outro(`
  Theme ready at ./${slug}/

  Next steps:
    cd ${slug}
    # Edit theme.css
    nuxflow theme deploy --site https://your-site.com
        `)
      },
    }),

    // ── nuxflow theme deploy ────────────────────────────────────────────────
    deploy: defineCommand({
      meta: { description: 'Upload the theme to a NuxFlow site (first time)' },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        intro('NuxFlow — Deploy Theme')
        const dir = process.cwd()

        const manifest = await orExit(readManifest(dir))

        const css = await orExit(readCss(dir))

        const bundleZip = await buildBundleZip(dir, manifest, css)

        const s = spinner()
        s.start('Authenticating…')

        const { site, cookie } = await authenticateOrExit(s, args)

        s.message(bundleZip
          ? `Uploading "${manifest.name}" v${manifest.version} (with demo content)…`
          : `Uploading "${manifest.name}" v${manifest.version}…`)

        try {
          const res = bundleZip
            ? await apiPostZip(site, '/api/v1/themes', cookie, `${manifest.name.toLowerCase().replace(/\s+/g, '-')}.zip`, bundleZip) as DeployResponse
            : await apiPost(site, '/api/v1/themes', cookie, {
                name: manifest.name,
                version: manifest.version,
                css,
              }) as DeployResponse

          // Persist the server-assigned ID so future `update` calls work without UI
          if (res.id) {
            const updated: ThemeManifest = { ...manifest, deployedId: res.id }
            await writeFile(join(dir, 'nuxflow.theme.json'), JSON.stringify(updated, null, 2) + '\n')
          }

          s.stop('Deployed!')

          if (res.hasDemoContent) consola.info('Demo content uploaded — import it from Admin → Themes after activating.')
          if (res.failedImages?.length) consola.warn(`Some demo images failed to upload: ${res.failedImages.join(', ')}`)
        } catch (e: unknown) {
          s.stop('Deploy failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        outro('Theme uploaded. Activate it in the NuxFlow admin → Themes.')
      },
    }),

    // ── nuxflow theme update ────────────────────────────────────────────────
    update: defineCommand({
      meta: { description: 'Push updated CSS to an already-deployed theme' },
      args: { ...AUTH_ARGS },
      async run({ args }) {
        intro('NuxFlow — Update Theme')
        const dir = process.cwd()

        const manifest = await orExit(readManifest(dir))

        if (!manifest.deployedId) {
          consola.error('No deployedId in nuxflow.theme.json — run `nuxflow theme deploy` first')
          process.exit(1)
        }

        const css = await orExit(readCss(dir))

        const s = spinner()
        s.start('Authenticating…')

        const { site, cookie } = await authenticateOrExit(s, args)

        s.message(`Updating "${manifest.name}"…`)

        try {
          await apiPatch(site, `/api/v1/themes/${manifest.deployedId}/css`, cookie, {
            css,
            version: manifest.version,
          })
          s.stop('Updated!')
        } catch (e: unknown) {
          s.stop('Update failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        outro('Theme CSS updated — live on the next page request, no redeploy needed.')
      },
    }),

  },
})
