import { defineCommand } from 'citty'
import { intro, text, confirm, outro, spinner } from '@clack/prompts'
import { consola } from 'consola'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { authenticate, apiPost, apiDelete, resolveAuth } from '../utils/api'
import { buildPlugin } from '../utils/build'
import { scaffoldPlugin } from '../utils/scaffold'

interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
}

function toKebab(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

async function readManifest(dir: string): Promise<PluginManifest> {
  const raw = await readFile(join(dir, 'nuxflow.plugin.json'), 'utf-8').catch(() => null)
  if (!raw) throw new Error('nuxflow.plugin.json not found — run this command from a plugin directory')
  return JSON.parse(raw) as PluginManifest
}

async function readDistJson(dir: string): Promise<Record<string, unknown>> {
  const p = join(dir, 'dist/plugin.json')
  if (!existsSync(p)) throw new Error('dist/plugin.json not found — run `nuxflow plugin build` first')
  return JSON.parse(await readFile(p, 'utf-8')) as Record<string, unknown>
}

export const pluginCommand = defineCommand({
  meta: { description: 'Manage NuxFlow dynamic plugins' },
  subCommands: {

    // ── nuxflow plugin create ───────────────────────────────────────────────
    create: defineCommand({
      meta: { description: 'Scaffold a new dynamic plugin project' },
      async run() {
        intro('NuxFlow — Create Plugin')

        const rawName = await text({ message: 'Plugin name:', placeholder: 'my-plugin' })
        if (!rawName || typeof rawName !== 'string') { outro('Cancelled'); return }

        const id = toKebab(rawName)
        if (!id) { consola.error('Invalid plugin name'); process.exit(1) }

        const rawDesc = await text({
          message: 'Short description (optional):',
          placeholder: 'What does this plugin do?',
        })
        const description = typeof rawDesc === 'string' ? rawDesc : ''

        const outDir = resolve(process.cwd(), id)
        if (existsSync(outDir)) {
          consola.error(`Directory already exists: ${outDir}`)
          process.exit(1)
        }

        const ok = await confirm({ message: `Create plugin "${id}" in ./${id}/` })
        if (!ok) { outro('Cancelled'); return }

        const s = spinner()
        s.start('Generating plugin files…')
        await scaffoldPlugin(outDir, id, id, description)
        s.stop('Plugin files created.')

        outro(`
  Plugin ready at ./${id}/

  Next steps:
    cd ${id}
    # Edit src/server.ts  (Cloudflare Worker API)
    # Edit src/client.ts  (Canvas block registration)
    nuxflow plugin build
    nuxflow plugin deploy --site https://your-site.com
        `)
      },
    }),

    // ── nuxflow plugin build ────────────────────────────────────────────────
    build: defineCommand({
      meta: { description: 'Build the plugin in the current directory' },
      async run() {
        intro('NuxFlow — Build Plugin')
        const dir = process.cwd()

        const manifest = await readManifest(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as PluginManifest

        const s = spinner()
        s.start(`Building ${manifest.name} v${manifest.version}…`)

        try {
          const { serverModule, clientBundle } = await buildPlugin(dir)

          if (!serverModule && !clientBundle) {
            s.stop('Nothing built — add src/server.ts and/or src/client.ts')
            process.exit(1)
          }

          const payload = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? '',
            ...(serverModule ? { serverModule } : {}),
            ...(clientBundle ? { clientBundle } : {}),
          }

          await writeFile(join(dir, 'dist/plugin.json'), JSON.stringify(payload, null, 2) + '\n')

          const parts = [serverModule && 'server', clientBundle && 'client'].filter(Boolean)
          s.stop(`Built: ${parts.join(' + ')} → dist/`)
        } catch (e: unknown) {
          s.stop('Build failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        outro('Ready to deploy — run `nuxflow plugin deploy`')
      },
    }),

    // ── nuxflow plugin deploy ───────────────────────────────────────────────
    deploy: defineCommand({
      meta: { description: 'Install the plugin on a NuxFlow site (first time)' },
      args: {
        site:     { type: 'string', description: 'Site URL             (or NUXFLOW_SITE)' },
        email:    { type: 'string', description: 'Admin email          (or NUXFLOW_EMAIL)' },
        password: { type: 'string', description: 'Admin password       (or NUXFLOW_PASSWORD)' },
      },
      async run({ args }) {
        intro('NuxFlow — Deploy Plugin')
        const dir = process.cwd()

        const payload = await readDistJson(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as Record<string, unknown>

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

        s.message(`Deploying ${payload.name as string} v${payload.version as string}…`)

        try {
          await apiPost(site, '/api/v1/dynamic-plugins', cookie, payload)
          s.stop('Deployed!')
        } catch (e: unknown) {
          s.stop('Deploy failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        outro(`Plugin installed. Enable it in the NuxFlow admin → Plugins.`)
      },
    }),

    // ── nuxflow plugin update ───────────────────────────────────────────────
    update: defineCommand({
      meta: { description: 'Update an already-installed plugin (removes then reinstalls)' },
      args: {
        site:     { type: 'string', description: 'Site URL             (or NUXFLOW_SITE)' },
        email:    { type: 'string', description: 'Admin email          (or NUXFLOW_EMAIL)' },
        password: { type: 'string', description: 'Admin password       (or NUXFLOW_PASSWORD)' },
      },
      async run({ args }) {
        intro('NuxFlow — Update Plugin')
        const dir = process.cwd()

        const manifest = await readManifest(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as PluginManifest

        const payload = await readDistJson(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as Record<string, unknown>

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

        s.message('Removing old version…')
        // Ignore 404 — plugin may not be installed yet
        await apiDelete(site, `/api/v1/dynamic-plugins/${manifest.id}`, cookie).catch(() => {})

        s.message(`Deploying ${manifest.name} v${manifest.version}…`)
        try {
          await apiPost(site, '/api/v1/dynamic-plugins', cookie, payload)
          s.stop('Updated!')
        } catch (e: unknown) {
          s.stop('Update failed.')
          consola.error((e as Error).message)
          process.exit(1)
        }

        outro('Plugin updated. Re-enable it in the NuxFlow admin if it was disabled.')
      },
    }),

  },
})
