import { defineCommand } from 'citty'
import { intro, text, confirm, outro, spinner } from '@clack/prompts'
import { consola } from 'consola'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { authenticate, apiPost, apiDelete, resolveAuth } from '../utils/api'
import { buildPlugin } from '../utils/build'
import { scaffoldPlugin } from '../utils/scaffold'
import { generateKeyPair, signPayload, type SigningPayload } from '../utils/signing'

interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  publisherPublicKey?: string  // base64url SPKI — present after `nuxflow plugin keygen`
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

async function readPrivateKey(dir: string): Promise<string> {
  const p = join(dir, '.nuxflow-private-key')
  if (!existsSync(p)) throw new Error('.nuxflow-private-key not found — run `nuxflow plugin keygen` first')
  return (await readFile(p, 'utf-8')).trim()
}

async function buildSigningPayload(
  manifest: PluginManifest,
  dist: Record<string, unknown>,
): Promise<SigningPayload> {
  return {
    id: manifest.id,
    version: manifest.version,
    serverChecksum: (dist.serverChecksum as string | undefined) ?? 'none',
    clientChecksum: (dist.clientChecksum as string | undefined) ?? 'none',
  }
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
    nuxflow plugin keygen          # generate your publisher keypair first
    # Edit src/server.ts  (Cloudflare Worker API)
    # Edit src/client.ts  (Canvas block registration)
    nuxflow plugin build
    nuxflow plugin deploy --site https://your-site.com
        `)
      },
    }),

    // ── nuxflow plugin keygen ───────────────────────────────────────────────
    keygen: defineCommand({
      meta: { description: 'Generate an Ed25519 publisher keypair for this plugin' },
      async run() {
        intro('NuxFlow — Generate Publisher Keypair')
        const dir = process.cwd()

        const manifest = await readManifest(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as PluginManifest

        if (manifest.publisherPublicKey) {
          const replace = await confirm({
            message: 'A keypair already exists for this plugin. Regenerating will invalidate all existing signatures. Continue?',
          })
          if (!replace) { outro('Cancelled'); return }
        }

        const s = spinner()
        s.start('Generating Ed25519 keypair…')

        const { privateKey, publicKey } = await generateKeyPair()

        // Write private key to a local-only file — never committed
        await writeFile(join(dir, '.nuxflow-private-key'), privateKey + '\n', { mode: 0o600 })

        // Embed public key in the manifest so it travels with the plugin source
        const updatedManifest = { ...manifest, publisherPublicKey: publicKey }
        await writeFile(
          join(dir, 'nuxflow.plugin.json'),
          JSON.stringify(updatedManifest, null, 2) + '\n',
        )

        s.stop('Keypair generated.')

        outro(`
  Private key → .nuxflow-private-key  (KEEP SECRET — never commit this)
  Public key  → nuxflow.plugin.json   (publisherPublicKey field)

  Add to .gitignore:
    .nuxflow-private-key

  The server will reject any plugin payload that doesn't carry a valid
  signature from this private key. Keep a secure backup of the private key
  — there is no recovery path if it is lost.
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

        if (!manifest.publisherPublicKey) {
          consola.error('No publisher keypair found. Run `nuxflow plugin keygen` before building.')
          process.exit(1)
        }

        const s = spinner()
        s.start(`Building ${manifest.name} v${manifest.version}…`)

        try {
          const { serverModule, serverChecksum, clientBundle, clientChecksum } = await buildPlugin(dir)

          if (!serverModule && !clientBundle) {
            s.stop('Nothing built — add src/server.ts and/or src/client.ts')
            process.exit(1)
          }

          const payload = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? '',
            ...(serverModule ? { serverModule, serverChecksum } : {}),
            ...(clientBundle ? { clientBundle, clientChecksum } : {}),
          }

          await writeFile(join(dir, 'dist/plugin.json'), JSON.stringify(payload, null, 2) + '\n')

          const parts = [serverModule && 'server', clientBundle && 'client'].filter(Boolean)
          s.stop(`Built: ${parts.join(' + ')} → dist/  (checksums included)`)
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

        const [manifest, dist] = await Promise.all([
          readManifest(dir).catch((e: Error) => { consola.error(e.message); process.exit(1) }) as Promise<PluginManifest>,
          readDistJson(dir).catch((e: Error) => { consola.error(e.message); process.exit(1) }) as Promise<Record<string, unknown>>,
        ])

        if (!manifest.publisherPublicKey) {
          consola.error('No publisher public key in nuxflow.plugin.json — run `nuxflow plugin keygen` first.')
          process.exit(1)
        }

        const privateKey = await readPrivateKey(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as string

        const s = spinner()
        s.start('Signing plugin payload…')

        const signingPayload = await buildSigningPayload(manifest, dist)
        const signature = await signPayload(privateKey, signingPayload)

        s.message('Authenticating…')

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

        s.message(`Deploying ${manifest.name as string} v${manifest.version as string}…`)

        try {
          await apiPost(site, '/api/v1/dynamic-plugins', cookie, {
            ...dist,
            publisherPublicKey: manifest.publisherPublicKey,
            signature,
          })
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

        const [manifest, dist] = await Promise.all([
          readManifest(dir).catch((e: Error) => { consola.error(e.message); process.exit(1) }) as Promise<PluginManifest>,
          readDistJson(dir).catch((e: Error) => { consola.error(e.message); process.exit(1) }) as Promise<Record<string, unknown>>,
        ])

        if (!manifest.publisherPublicKey) {
          consola.error('No publisher public key in nuxflow.plugin.json — run `nuxflow plugin keygen` first.')
          process.exit(1)
        }

        const privateKey = await readPrivateKey(dir).catch((e: Error) => {
          consola.error(e.message); process.exit(1)
        }) as string

        const s = spinner()
        s.start('Signing plugin payload…')

        const signingPayload = await buildSigningPayload(manifest, dist)
        const signature = await signPayload(privateKey, signingPayload)

        s.message('Authenticating…')

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
          await apiPost(site, '/api/v1/dynamic-plugins', cookie, {
            ...dist,
            publisherPublicKey: manifest.publisherPublicKey,
            signature,
          })
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
