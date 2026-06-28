import * as p from '@clack/prompts'
import { downloadTemplate } from 'giget'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, basename } from 'node:path'

const REPO = 'github:NuxFlow/NuxFlow'
const DOCS_URL = 'https://nuxflow.dev/docs'
const GITHUB_URL = 'https://github.com/NuxFlow/NuxFlow'

function generateSecret(): string {
  const bytes = new Uint8Array(48)
  globalThis.crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

function buildEnv(template: string, secret: string, siteUrl: string): string {
  return template
    // Remove the Turso section (comment line + 2 var lines)
    .replace(
      /^# Option B: Turso.*\r?\nNUXT_TURSO_URL=.*\r?\nNUXT_TURSO_AUTH_TOKEN=.*\r?\n/m,
      '',
    )
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
  s.start('Downloading NuxFlow...')

  try {
    await downloadTemplate(REPO, { dir: targetDir, preferOffline: false })
  }
  catch (err) {
    s.stop('Download failed')
    p.cancel(`Could not download template: ${(err as Error).message}\n\nCheck your internet connection and try again.`)
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
      '  # 1. Create your Cloudflare D1 database:',
      '  wrangler login',
      '  cd apps/nuxflow',
      '  wrangler d1 create nuxflow',
      '',
      '  # 2. Paste the returned database_id into:',
      `  #    ${relDir}/apps/nuxflow/wrangler.toml  →  [[d1_databases]]`,
      '',
      '  # 3. Start the local dev server:',
      '  wrangler dev',
      '',
      '  # → Visit http://localhost:8787/setup to finish setup',
      '',
      '  # 4. When ready to go live:',
      '  pnpm run deploy',
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
