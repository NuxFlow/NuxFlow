import { defineCommand } from 'citty'
import { intro, text, confirm, outro, spinner } from '@clack/prompts'
import { consola } from 'consola'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { authenticate, apiPost, apiPatch, resolveAuth } from '../utils/api'
import { scaffoldTheme } from '../utils/scaffold'

interface ThemeManifest {
  name: string
  version: string
  deployedId?: string
}

async function readManifest(dir: string): Promise<ThemeManifest> {
  const raw = await readFile(join(dir, 'nuxflow.theme.json'), 'utf-8').catch(() => null)
  if (!raw) throw new Error('nuxflow.theme.json not found — run this command from a theme directory')
  return JSON.parse(raw) as ThemeManifest
}

async function readCss(dir: string): Promise<string> {
  const p = join(dir, 'theme.css')
  if (!existsSync(p)) throw new Error('theme.css not found — run this command from a theme directory')
  return readFile(p, 'utf-8')
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
      args: {
        site:     { type: 'string', description: 'Site URL             (or NUXFLOW_SITE)' },
        email:    { type: 'string', description: 'Admin email          (or NUXFLOW_EMAIL)' },
        password: { type: 'string', description: 'Admin password       (or NUXFLOW_PASSWORD)' },
      },
      async run({ args }) {
        intro('NuxFlow — Deploy Theme')
        const dir = process.cwd()

        const manifest = await readManifest(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as ThemeManifest

        const css = await readCss(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as string

        const s = spinner()
        s.start('Authenticating…')

        let site: string, cookie: string
        try {
          const auth = resolveAuth(args)
          cookie = await authenticate(auth.site, auth.email, auth.password)
          site = auth.site
        } catch (e: unknown) {
          s.stop('Auth failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        s.message(`Uploading "${manifest.name}" v${manifest.version}…`)

        try {
          const res = await apiPost(site, '/api/v1/themes', cookie, {
            name: manifest.name,
            version: manifest.version,
            css,
          }) as { id?: string }

          // Persist the server-assigned ID so future `update` calls work without UI
          if (res.id) {
            const updated: ThemeManifest = { ...manifest, deployedId: res.id }
            await writeFile(join(dir, 'nuxflow.theme.json'), JSON.stringify(updated, null, 2) + '\n')
          }

          s.stop('Deployed!')
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
      args: {
        site:     { type: 'string', description: 'Site URL             (or NUXFLOW_SITE)' },
        email:    { type: 'string', description: 'Admin email          (or NUXFLOW_EMAIL)' },
        password: { type: 'string', description: 'Admin password       (or NUXFLOW_PASSWORD)' },
      },
      async run({ args }) {
        intro('NuxFlow — Update Theme')
        const dir = process.cwd()

        const manifest = await readManifest(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as ThemeManifest

        if (!manifest.deployedId) {
          consola.error('No deployedId in nuxflow.theme.json — run `nuxflow theme deploy` first')
          process.exit(1)
        }

        const css = await readCss(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as string

        const s = spinner()
        s.start('Authenticating…')

        let site: string, cookie: string
        try {
          const auth = resolveAuth(args)
          cookie = await authenticate(auth.site, auth.email, auth.password)
          site = auth.site
        } catch (e: unknown) {
          s.stop('Auth failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

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
