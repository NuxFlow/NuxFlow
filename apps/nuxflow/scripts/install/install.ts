// pnpm nuxflow:install — puts NuxFlow on your own Cloudflare account in one go: logs in,
// creates the D1 database, KV namespace and R2 bucket, writes their ids into
// apps/nuxflow/wrangler.toml (keeping its comments), creates the sign-in secret, deploys,
// and prints the address of the setup wizard. Safe to run again after a failure: whatever
// already exists is found and reused, and a filled-in wrangler.toml just deploys.
//
// For self-hosters. Hosting platforms with pools and release rings start from an install
// like this and then use pnpm pool:create / ring:* (docs/pools.md).
//
//   --name <name>      the Worker's name (default nuxflow); the database, KV namespace
//                      and bucket are named after it
//   --location <hint>  where D1 keeps the data: weur, eeur, apac, oc, wnam, enam
//   --dry-run          show what would happen; create nothing
//   --yes              don't ask questions (uses the defaults)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseTOML } from 'confbox'
import { APP_DIR, confirm, fail, heading, runMain, wranglerCapture, wranglerLive, wranglerTee } from '../release/shell'
import { findD1Id, findKvId, hasBucket, hasSecret, isWorkerMissing } from '../pools/lib'
import {
  configProblems, fillConfig, installNames, looksLikeFreePlan, nameProblem, needsResources, parseInstallFlags, parseWhoami, workersDevUrl,
  type CloudflareAccount, type InstallNames,
} from './lib'

const HELP = `pnpm nuxflow:install [--name nuxflow] [--location weur] [--dry-run] [--yes]

Installs NuxFlow on your own Cloudflare account (Workers Paid plan needed): creates the
database, the KV namespace and the file storage bucket, fills in apps/nuxflow/wrangler.toml,
creates the sign-in secret, deploys, and prints the link to the setup wizard.
Safe to run again: anything that already exists is reused. See docs/installation.md.`

const CONFIG = 'wrangler.toml'
const EXAMPLE = 'wrangler.toml.example'
const SECRET_NAME = 'NUXT_BETTER_AUTH_SECRET'

function randomSecret(): string {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString('base64url')
}

function wranglerOut(args: string[], what: string): string {
  const res = wranglerCapture(args)
  if (!res.ok) fail(`${what} failed:\n${res.err || res.out}`)
  return res.out
}

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) fail('Nobody is here to answer the question. Run it in a terminal, or add --yes.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

async function askName(fallback: string): Promise<string> {
  for (;;) {
    const answer = (await ask(`\nWhat should your Worker be called? Press Enter for "${fallback}": `)).toLowerCase() || fallback
    const problem = nameProblem(answer)
    if (!problem) return answer
    console.log(problem)
  }
}

async function askAccount(accounts: CloudflareAccount[]): Promise<CloudflareAccount> {
  console.log('\nYour login can use several Cloudflare accounts:')
  accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`))
  for (;;) {
    const n = Number(await ask('Which one should NuxFlow go in? Type its number: '))
    const account = accounts[n - 1]
    if (Number.isInteger(n) && account) return account
  }
}

function logIn(): CloudflareAccount[] {
  const check = () => parseWhoami(wranglerCapture(['whoami', '--json']).out)
  let who = check()
  if (!who.loggedIn) {
    heading('Log in to Cloudflare')
    console.log('A browser window opens: log in and press Allow, then come back here.')
    if (!wranglerLive(['login'])) fail('Logging in to Cloudflare didn\'t finish. Run pnpm nuxflow:install again to retry.')
    who = check()
    if (!who.loggedIn) fail('Still not logged in to Cloudflare. Run pnpm exec wrangler login in apps/nuxflow, then try again.')
  }
  if (!who.accounts.length) fail('This Cloudflare login can\'t see any account. Check the account in the Cloudflare dashboard, then try again.')
  return who.accounts
}

function existingD1(names: InstallNames): string | null {
  return findD1Id(wranglerOut(['d1', 'list', '--json'], 'Listing D1 databases'), names.database)
}

function existingKv(names: InstallNames): string | null {
  return findKvId(wranglerOut(['kv', 'namespace', 'list'], 'Listing KV namespaces'), names.kv)
}

function existingBucket(names: InstallNames): boolean {
  const res = wranglerCapture(['r2', 'bucket', 'list'])
  // R2 has to be switched on once in the dashboard before any bucket can be listed or made.
  if (!res.ok) fail(`Listing R2 buckets failed. If this is a new account, open Cloudflare dashboard → R2 Object Storage once and accept the terms, then run this again.\n${res.err || res.out}`)
  return hasBucket(res.out, names.bucket)
}

runMain(async () => {
  let flags: ReturnType<typeof parseInstallFlags>
  try {
    flags = parseInstallFlags(process.argv.slice(2))
  } catch (err) {
    fail((err as Error).message)
  }
  if (flags.help) return console.log(HELP)

  heading('Installing NuxFlow on Cloudflare')
  console.log('This needs a Cloudflare account on the Workers Paid plan ($5 a month): NuxFlow\'s password')
  console.log('hashing and plugins need more than the free plan allows.')

  const configPath = join(APP_DIR, CONFIG)
  const hasConfig = existsSync(configPath)
  const text = readFileSync(join(APP_DIR, hasConfig ? CONFIG : EXAMPLE), 'utf8')
  const parsed = parseTOML(text) as Record<string, unknown>
  const fresh = needsResources(text)
  const configName = typeof parsed.name === 'string' ? parsed.name : 'nuxflow'

  // A filled-in wrangler.toml is already this install: never rename or re-point it.
  let name: string
  if (!fresh) {
    if (flags.name && flags.name !== configName) fail(`apps/nuxflow/${CONFIG} is already set up for "${configName}". Leave out --name to deploy it, or move that file away to start a new install.`)
    name = configName
  } else {
    name = flags.name ?? (flags.yes ? configName : await askName(configName))
  }
  let names: InstallNames
  try {
    names = installNames(name)
  } catch (err) {
    fail((err as Error).message)
  }

  const accounts = logIn()
  const configuredAccount = typeof parsed.account_id === 'string' ? parsed.account_id : process.env.CLOUDFLARE_ACCOUNT_ID
  let newAccountId: string | undefined
  if (!configuredAccount && accounts.length > 1) {
    if (flags.yes) fail('Your login can use several Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID to the one to use, or run without --yes to choose.')
    const account = await askAccount(accounts)
    newAccountId = account.id
  }
  // Every wrangler command below runs in apps/nuxflow and inherits this.
  const accountId = newAccountId ?? configuredAccount
  if (accountId) process.env.CLOUDFLARE_ACCOUNT_ID = accountId
  const accountName = accounts.find(a => a.id === accountId)?.name ?? accounts[0]!.name

  // Read-only look at what's already there, so the summary is honest about reuse.
  let d1Id: string | null = null
  let kvId: string | null = null
  let bucketExists = false
  if (fresh) {
    d1Id = existingD1(names)
    kvId = existingKv(names)
    bucketExists = existingBucket(names)
  }

  // Does the Worker exist yet, and does it have its sign-in secret? The secret also
  // encrypts the site's stored API keys, so it's only ever created, never replaced: a new
  // one would make every saved key unreadable. Any answer but "no such Worker" stops here.
  const secrets = wranglerCapture(['secret', 'list', '--name', names.worker, '--format', 'json'])
  const workerMissing = !secrets.ok && isWorkerMissing(`${secrets.err}\n${secrets.out}`, names.worker)
  if (!secrets.ok && !workerMissing) fail(`Couldn't check the Worker's secrets, so nothing was changed:\n${secrets.err || secrets.out}`)
  const needsSecret = workerMissing || !hasSecret(secrets.out, SECRET_NAME)

  heading('The plan')
  console.log(`Account:   ${accountName}`)
  console.log(`Worker:    ${names.worker}${workerMissing ? ' (new)' : ' (ALREADY EXISTS: this deploys the code you have here over it; its data is kept)'}`)
  if (fresh) {
    console.log(`Database:  D1 "${names.database}"${d1Id ? ' (already exists: it will be reused)' : flags.location ? ` (new, location ${flags.location})` : ' (new)'}`)
    console.log(`KV:        "${names.kv}"${kvId ? ' (already exists: it will be reused)' : ' (new)'}`)
    console.log(`Files:     R2 bucket "${names.bucket}"${bucketExists ? ' (already exists: it will be reused)' : ' (new)'}`)
    console.log(`Also on:   Workers AI and visitor analytics (nothing to create; both are in the Paid plan)`)
    console.log(`Config:    apps/nuxflow/${CONFIG} (${hasConfig ? 'filled in' : `made from ${EXAMPLE}`}; its comments are kept)`)
  } else {
    console.log(`Config:    apps/nuxflow/${CONFIG} is already filled in, so this only deploys it.`)
  }
  console.log(`Then:      build and deploy (a few minutes)${needsSecret ? ', with a new sign-in secret' : ''}.`)
  if (flags.dryRun) {
    console.log('\nDry run: nothing was created or deployed.')
    return
  }
  await confirm('Go ahead?', flags.yes)

  if (fresh) {
    heading('D1 database')
    if (d1Id) {
      console.log(`Reusing ${names.database}`)
    } else {
      if (!wranglerLive(['d1', 'create', names.database, ...(flags.location ? ['--location', flags.location] : [])])) {
        fail('Creating the database failed (see above). Run pnpm nuxflow:install again once it\'s fixed; nothing is created twice.')
      }
      d1Id = existingD1(names) ?? fail(`Created ${names.database}, but can't find it in wrangler d1 list.`)
    }

    heading('KV namespace')
    if (kvId) {
      console.log(`Reusing ${names.kv}`)
    } else {
      if (!wranglerLive(['kv', 'namespace', 'create', names.kv])) fail('Creating the KV namespace failed (see above). Run pnpm nuxflow:install again once it\'s fixed.')
      kvId = existingKv(names) ?? fail(`Created ${names.kv}, but can't find it in wrangler kv namespace list.`)
    }

    heading('R2 bucket')
    if (bucketExists) console.log(`Reusing ${names.bucket}`)
    else if (!wranglerLive(['r2', 'bucket', 'create', names.bucket])) fail('Creating the bucket failed (see above). Run pnpm nuxflow:install again once it\'s fixed.')

    let filled: string
    try {
      filled = fillConfig(text, { names, databaseId: d1Id, kvId, accountId: newAccountId })
    } catch (err) {
      fail((err as Error).message)
    }
    const problems = configProblems(parseTOML(filled) as Record<string, unknown>, { names, databaseId: d1Id, kvId })
    if (problems.length) fail(`The new wrangler.toml didn't come out right, so it wasn't saved: ${problems.join('; ')}.`)
    writeFileSync(configPath, filled)
    console.log(`\nWrote apps/nuxflow/${CONFIG}`)
  }

  // Inside .wrangler/ (gitignored), and removed straight after the deploy.
  const secretsFile = '.wrangler/install-secrets.json'

  heading('Building and deploying')
  let result: { ok: boolean; out: string }
  try {
    if (needsSecret) {
      mkdirSync(join(APP_DIR, '.wrangler'), { recursive: true })
      writeFileSync(join(APP_DIR, secretsFile), JSON.stringify({ [SECRET_NAME]: randomSecret() }), { mode: 0o600 })
    }
    result = await wranglerTee(['deploy', ...(needsSecret ? ['--secrets-file', secretsFile] : [])])
  } finally {
    rmSync(join(APP_DIR, secretsFile), { force: true })
  }
  if (!result.ok) {
    const hint = looksLikeFreePlan(result.out)
      ? '\nThis looks like the account isn\'t on the Workers Paid plan yet: Cloudflare dashboard → Workers & Pages → Plans.'
      : ''
    fail(`The deploy failed (see above).${hint}\nRun pnpm nuxflow:install again once it's fixed: what was created is reused.`)
  }

  const url = workersDevUrl(result.out)
  heading('Done')
  if (url) {
    console.log(`NuxFlow is live. Open this link to create your site and admin account:\n\n  ${url}/setup\n`)
  } else {
    console.log('NuxFlow is live. Open your Worker\'s address (Cloudflare dashboard → Workers & Pages →')
    console.log(`${names.worker}) and add /setup to it, to create your site and admin account.\n`)
  }
  console.log('Do it now: until the wizard is finished, whoever opens that link first becomes the owner.')
  console.log('The database sets itself up on that first visit. Afterwards, your dashboard\'s')
  console.log('"Finish setting up your site" list walks you through the rest. The main ones:')
  console.log(`  • Your own domain: Cloudflare → Workers & Pages → ${names.worker} → Settings → Domains & Routes.`)
  console.log('  • Email: pnpm exec wrangler email sending enable <your domain>  (run in apps/nuxflow)')
  console.log('  • Semantic search and the rest: docs/installation.md, "Additional Configuration".')
  console.log('\nTo deploy updates later: git pull, pnpm install, then pnpm nuxflow:install again.')
})
