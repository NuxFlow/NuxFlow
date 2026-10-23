// pnpm pool:create <name> — sets up a member pool of a hosting platform: its own D1 and
// KV, a wrangler config made from the control plane's, its own sign-in secret, a first
// deploy, and a line in release-targets.json so the ring scripts deploy it from then on.
// Safe to run again after a failure: whatever already exists is found and reused.
//
//   --from <file>      the control plane's wrangler config (default wrangler.toml)
//   --ring 1|2         which ring the pool joins (default 2)
//   --location <hint>  where D1 keeps the data: weur, eeur, apac, oc, wnam, enam
//   --own-bucket       its own R2 bucket for files (nuxflow-pool-<name>-media), not the shared one
//   --bucket <name>    the same, with that bucket name
//   --jurisdiction eu  D1 and the bucket (always its own) stay in the EU
//   --dry-run          show what would happen; create nothing
//   --yes              don't ask for confirmation
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseJSONC, parseTOML } from 'confbox'
import { TARGETS_FILE } from '../release/lib'
import {
  APP_DIR,
  confirm,
  deployTarget,
  fail,
  heading,
  headCommit,
  requireCleanTree,
  runMain,
  shortSha,
  wranglerCapture,
  wranglerLive,
} from '../release/shell'
import { addPoolTarget, buildPoolConfig, findD1Id, findKvId, hasBucket, hasSecret, ownBucket, parsePoolFlags, poolConfigFile, poolNames, routerBindingBlock, serviceBindingBlock, type OwnBucket } from './lib'

const HELP = `pnpm pool:create <name> [--from wrangler.cloud.toml] [--ring 1|2] [--location weur | --jurisdiction eu] [--own-bucket | --bucket <name>] [--dry-run] [--yes]

Sets up a member pool of a hosting platform: a Worker "nuxflow-pool-<name>" with its own
D1 and KV, a config made from the control plane's (--from), and its own sign-in secret,
then deploys it and adds it to apps/nuxflow/release-targets.json. With --own-bucket or
--bucket it gets its own R2 bucket for files; --jurisdiction eu keeps its database and
files in the EU. See docs/pools.md.`

const SECRET_NAME = 'NUXT_BETTER_AUTH_SECRET'
// Cloudflare's answer for a Worker that hasn't been deployed yet (API error 10007).
const WORKER_MISSING_RE = /\b10007\b|script_not_found|worker does not exist/i

function wranglerJson(args: string[], what: string): string {
  const res = wranglerCapture(args)
  if (!res.ok) fail(`${what} failed:\n${res.err || res.out}`)
  return res.out
}

function readConfig(file: string): Record<string, unknown> {
  const path = join(APP_DIR, file)
  if (!existsSync(path)) fail(`apps/nuxflow/${file} doesn't exist. Pass the control plane's config with --from.`)
  const text = readFileSync(path, 'utf8')
  return (file.endsWith('.toml') ? parseTOML(text) : parseJSONC(text)) as Record<string, unknown>
}

function randomSecret(): string {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString('base64url')
}

runMain(async () => {
  let flags: ReturnType<typeof parsePoolFlags>
  try {
    flags = parsePoolFlags(process.argv.slice(2))
  } catch (err) {
    fail((err as Error).message)
  }
  if (flags.help || !flags.poolId) return console.log(HELP)

  const poolId = flags.poolId
  let names: ReturnType<typeof poolNames>
  let bucket: OwnBucket | null
  try {
    names = poolNames(poolId)
    bucket = ownBucket(flags, poolId)
  } catch (err) {
    fail((err as Error).message)
  }
  const targetsPath = join(APP_DIR, TARGETS_FILE)
  if (!existsSync(targetsPath)) fail(`apps/nuxflow/${TARGETS_FILE} doesn't exist yet. Copy release-targets.example.json first.`)
  requireCleanTree()

  const configPath = join(APP_DIR, names.config)
  const configExists = existsSync(configPath)
  // Checks the control plane's config before anything is created on Cloudflare.
  const base = readConfig(flags.from)
  try {
    buildPoolConfig(base, { poolId, databaseId: 'check', kvId: 'check', bucket: bucket ?? undefined })
  } catch (err) {
    fail((err as Error).message)
  }

  heading(`New pool: ${poolId}`)
  console.log(`Worker:    ${names.worker} (no routes: traffic arrives through the platform's router)`)
  console.log(`D1:        ${names.database}${flags.jurisdiction ? ` (kept in the ${flags.jurisdiction.toUpperCase()})` : flags.location ? ` (location ${flags.location})` : ''}`)
  console.log(`KV:        ${names.kv}`)
  console.log(`Files:     ${bucket ? `its own R2 bucket ${bucket.name}${bucket.jurisdiction ? ` (kept in the ${bucket.jurisdiction.toUpperCase()})` : ''}` : `the shared R2 bucket from ${flags.from}`}`)
  console.log(`Shared:    Analytics Engine, Vectorize, AI and email from ${flags.from}`)
  if (flags.jurisdiction) console.log('Note:      KV (plugin code, theme CSS, caches) has no EU option; it is stored globally.')
  console.log(`Config:    apps/nuxflow/${names.config}${configExists ? ' (exists, reused)' : ` (made from ${flags.from})`}`)
  console.log(`Ring:      ${flags.ring}`)
  if (flags.dryRun) {
    console.log('\nDry run: nothing was created or deployed.')
    return
  }
  await confirm(`Create pool "${poolId}" on Cloudflare?`, flags.yes)

  if (!configExists) {
    heading('D1 database')
    let databaseId = findD1Id(wranglerJson(['d1', 'list', '--json'], 'Listing D1 databases'), names.database)
    if (databaseId) {
      console.log(`Already exists: ${databaseId}`)
    } else {
      const args = ['d1', 'create', names.database, ...(flags.jurisdiction ? ['--jurisdiction', flags.jurisdiction] : flags.location ? ['--location', flags.location] : [])]
      if (!wranglerLive(args)) fail('Creating the D1 database failed (see above). Run pnpm pool:create again once it\'s fixed.')
      databaseId = findD1Id(wranglerJson(['d1', 'list', '--json'], 'Listing D1 databases'), names.database)
        ?? fail(`Created ${names.database}, but can't find it in wrangler d1 list.`)
    }

    heading('KV namespace')
    let kvId = findKvId(wranglerJson(['kv', 'namespace', 'list'], 'Listing KV namespaces'), names.kv)
    if (kvId) {
      console.log(`Already exists: ${kvId}`)
    } else {
      if (!wranglerLive(['kv', 'namespace', 'create', names.kv])) fail('Creating the KV namespace failed (see above). Run pnpm pool:create again once it\'s fixed.')
      kvId = findKvId(wranglerJson(['kv', 'namespace', 'list'], 'Listing KV namespaces'), names.kv)
        ?? fail(`Created ${names.kv}, but can't find it in wrangler kv namespace list.`)
    }

    if (bucket) {
      heading('R2 bucket')
      const jurisdiction = bucket.jurisdiction ? ['--jurisdiction', bucket.jurisdiction] : []
      if (hasBucket(wranglerJson(['r2', 'bucket', 'list', ...jurisdiction], 'Listing R2 buckets'), bucket.name)) {
        console.log(`Already exists: ${bucket.name}`)
      } else if (!wranglerLive(['r2', 'bucket', 'create', bucket.name, ...jurisdiction])) {
        fail('Creating the R2 bucket failed (see above). Run pnpm pool:create again once it\'s fixed.')
      }
    }

    writeFileSync(configPath, poolConfigFile(buildPoolConfig(base, { poolId, databaseId, kvId, bucket: bucket ?? undefined }), { poolId, from: flags.from }))
    console.log(`\nWrote apps/nuxflow/${names.config}`)
  }

  // Its own sign-in secret (it also encrypts the pool's secret settings), uploaded with
  // the first deploy — never replaced once the Worker has one, or stored secrets would
  // become unreadable.
  const existingSecrets = wranglerCapture(['secret', 'list', '--config', names.config, '--format', 'json'])
  // Only "this Worker doesn't exist yet" means no secret. Any other failure stops here:
  // guessing wrong would replace a running pool's secret.
  if (!existingSecrets.ok && !WORKER_MISSING_RE.test(`${existingSecrets.err}\n${existingSecrets.out}`)) {
    fail(`Couldn't check the pool's secrets, so nothing was deployed:\n${existingSecrets.err || existingSecrets.out}`)
  }
  const needsSecret = !existingSecrets.ok || !hasSecret(existingSecrets.out, SECRET_NAME)
  // Inside .wrangler/ (gitignored), and removed straight after the deploy.
  const secretsFile = `.wrangler/pool-secrets-${poolId}.json`
  const target = { name: `pool:${poolId}`, ring: flags.ring, config: names.config }
  let deployed: boolean
  try {
    if (needsSecret) {
      mkdirSync(join(APP_DIR, '.wrangler'), { recursive: true })
      writeFileSync(join(APP_DIR, secretsFile), JSON.stringify({ [SECRET_NAME]: randomSecret() }), { mode: 0o600 })
    }
    const commit = headCommit()
    deployed = deployTarget(target, { tag: `new-pool-${poolId}`, commit }, needsSecret ? ['--secrets-file', secretsFile] : [])
  } finally {
    rmSync(join(APP_DIR, secretsFile), { force: true })
  }
  if (!deployed) fail('The first deploy failed (see above). Run pnpm pool:create again once it\'s fixed; nothing is created twice.')

  const { json, added } = addPoolTarget(readFileSync(targetsPath, 'utf8'), target)
  if (added) writeFileSync(targetsPath, json)

  heading('Done')
  console.log(`Pool "${poolId}" runs commit ${shortSha(headCommit())}, with no sites yet.`)
  console.log(added ? `Added to ${TARGETS_FILE} as ring ${flags.ring}: pnpm ring:canary / ring:promote deploy it from now on.` : `Already in ${TARGETS_FILE}.`)

  heading('Next: connect it to the control panel')
  console.log(`1. Add this to the end of apps/nuxflow/${flags.from}:\n`)
  console.log(serviceBindingBlock(poolId))
  console.log(`\n2. Deploy the control panel (the Worker in ${flags.from}).`)
  console.log('3. Super Admin → Pools: the pool appears. Press "Send platform settings".')
  console.log('4. If the front-door router is set up (packages/router), add this to packages/router/wrangler.toml and deploy it:\n')
  console.log(routerBindingBlock(poolId))
})
