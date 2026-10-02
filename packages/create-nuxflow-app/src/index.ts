import * as p from '@clack/prompts'
import { downloadTemplate } from 'giget'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, basename } from 'node:path'

// Injected by tsup from package.json (see tsup.config.ts); undefined under `tsx` in dev.
declare const __NUXFLOW_VERSION__: string | undefined

// Download the exact release this scaffolder was published with, never whatever happens
// to be on `main`: changesets tags every published version as `create-nuxflow-app@<v>`,
// and the package is in a changesets `fixed` group with the app, so a new app release
// always ships a new scaffolder pointing at it. NUXFLOW_TEMPLATE_REF overrides it (a
// branch, tag, or commit) for testing unreleased changes.
const VERSION = typeof __NUXFLOW_VERSION__ === 'string' ? __NUXFLOW_VERSION__ : undefined
const TEMPLATE_REF = process.env.NUXFLOW_TEMPLATE_REF || (VERSION ? `create-nuxflow-app@${VERSION}` : 'main')
const REPO = `github:NuxFlow/NuxFlow#${TEMPLATE_REF}`
const DOCS_URL = 'https://nuxflow.dev/docs'
const GITHUB_URL = 'https://github.com/NuxFlow/NuxFlow'

function generateSecret(): string {
  const bytes = new Uint8Array(48)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

function buildEnv(template: string, secret: string, siteUrl: string): string {
  return template
    .replace(
      /NUXT_BETTER_AUTH_SECRET=.*/,
      `NUXT_BETTER_AUTH_SECRET=${secret}`,
    )
    .replace(
      /NUXT_PUBLIC_SITE_URL=.*/,
      `NUXT_PUBLIC_SITE_URL=${siteUrl}`,
    )
}

function hasPnpm(): boolean {
  try {
    execSync('pnpm --version', { stdio: 'pipe' })
    return true
  }
  catch {
    return false
  }
}

async function main() {
  console.log()
  p.intro('create-nuxflow-app  —  Edge-native CMS on Nuxt 4 + Cloudflare Workers')

  // ── 1. Project directory ──────────────────────────────────────────────────
  const dir = await p.text({
    message: 'Where should we create your project?',
    placeholder: './my-nuxflow-site',
    validate(value) {
      if (!value.trim()) return 'Please enter a directory name'
      if (existsSync(resolve(value))) return `"${value}" already exists — choose a different name`
    },
  })
  if (p.isCancel(dir)) { p.cancel('Cancelled.'); process.exit(0) }

  const targetDir = resolve(dir as string)
  const projectName = basename(targetDir)

  // ── 2. Site URL ───────────────────────────────────────────────────────────
  const siteUrl = await p.text({
    message: 'What will your production site URL be?',
    placeholder: 'https://yourdomain.com',
    defaultValue: 'https://yourdomain.com',
    validate(value) {
      if (!value.trim()) return 'Please enter a URL'
      try { new URL(value) }
      catch { return 'Must be a valid URL (e.g. https://yourdomain.com)' }
    },
  })
  if (p.isCancel(siteUrl)) { p.cancel('Cancelled.'); process.exit(0) }

  // ── 3. pnpm install? ──────────────────────────────────────────────────────
  const pnpmAvailable = hasPnpm()
  const installDeps = pnpmAvailable
    ? await p.confirm({
        message: 'Install dependencies now?',
        initialValue: true,
      })
    : false
  if (p.isCancel(installDeps)) { p.cancel('Cancelled.'); process.exit(0) }

  // ── 4. Download template ──────────────────────────────────────────────────
  const s = p.spinner()
  s.start(`Downloading NuxFlow (${TEMPLATE_REF})...`)

  try {
    await downloadTemplate(REPO, { dir: targetDir, preferOffline: false })
  }
  catch (err) {
    s.stop('Download failed')
    p.cancel(`Could not download NuxFlow (${TEMPLATE_REF}): ${(err as Error).message}\n\nCheck your internet connection and try again.`)
    process.exit(1)
  }

  s.stop('Downloaded NuxFlow')

  // ── 5. Configure wrangler.toml ────────────────────────────────────────────
  const appDir = join(targetDir, 'apps', 'nuxflow')
  const wranglerExample = join(appDir, 'wrangler.toml.example')
  const wranglerDest = join(appDir, 'wrangler.toml')

  if (existsSync(wranglerExample) && !existsSync(wranglerDest)) {
    writeFileSync(wranglerDest, readFileSync(wranglerExample, 'utf8'))
  }

  // ── 6. Configure .env ─────────────────────────────────────────────────────
  const envExample = join(appDir, '.env.example')
  const envDest = join(appDir, '.env')

  if (existsSync(envExample) && !existsSync(envDest)) {
    const secret = generateSecret()
    const envContent = buildEnv(readFileSync(envExample, 'utf8'), secret, siteUrl as string)
    writeFileSync(envDest, envContent)
  }

  // ── 7. Install dependencies ───────────────────────────────────────────────
  if (installDeps) {
    p.log.step('Installing dependencies — this takes a minute on first install...')
    try {
      execSync('pnpm install', { cwd: targetDir, stdio: 'inherit' })
      p.log.success('Dependencies installed')
    }
    catch {
      p.log.warn('pnpm install failed — run it manually after setup')
    }
  }
  else if (!pnpmAvailable) {
    p.note('pnpm was not found. Install it with:\n  npm install -g pnpm\nThen run pnpm install inside your project.', 'pnpm required')
  }

  // ── 8. Next steps ─────────────────────────────────────────────────────────
  const relDir = dir as string
  const installNote = installDeps ? '' : `\n  pnpm install\n`

  p.note(
    [
      `  cd ${relDir}`,
      installNote,
      '  # Try it locally (a local database is created for you):',
      '  cd apps/nuxflow',
      '  pnpm exec wrangler dev',
      '  # → Visit http://localhost:8787/setup to finish setup',
      '',
      '  # Go live on Cloudflare — create the D1 database, KV namespace and',
      '  # R2 bucket, deploy, then add the auth secret. Step by step:',
      `  #   ${DOCS_URL}`,
      '  # (The .env created here is for local development only.)',
    ].filter(line => line !== undefined).join('\n'),
    'Next steps',
  )

  p.outro(
    `${projectName} is ready!\n\n  Docs   ${DOCS_URL}\n  GitHub ${GITHUB_URL}`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
