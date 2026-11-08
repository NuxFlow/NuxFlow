// pnpm nuxflow:install — the pure logic (no Cloudflare, no files), unit-tested in
// tests/unit/install-script.test.ts. The script is for self-hosters putting NuxFlow on
// their own Cloudflare account: one Worker, one D1, one KV namespace, one R2 bucket.
// Hosting platforms with pools and release rings use pnpm pool:create / ring:* on top of
// an install like this one; nothing here knows about them.
import { D1_LOCATIONS } from '../pools/lib'

export interface InstallFlags {
  /** The Worker's name; the database, KV namespace and bucket are named after it. */
  name: string | null
  /** D1 location hint (weur, eeur, apac, oc, wnam, enam). */
  location: string | null
  dryRun: boolean
  yes: boolean
  help: boolean
}

export function parseInstallFlags(argv: readonly string[]): InstallFlags {
  const flags: InstallFlags = { name: null, location: null, dryRun: false, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') continue
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined]
    const value = () => {
      const v = inline ?? argv[++i]
      if (!v) throw new Error(`${flag} needs a value.`)
      return v
    }
    switch (flag) {
      case '--dry-run': flags.dryRun = true; break
      case '--yes': flags.yes = true; break
      case '--help': case '-h': flags.help = true; break
      case '--name': flags.name = value(); break
      case '--location': {
        const location = value()
        if (!D1_LOCATIONS.has(location)) throw new Error(`--location must be one of: ${[...D1_LOCATIONS].join(', ')}.`)
        flags.location = location
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }
  return flags
}

export interface InstallNames {
  worker: string
  database: string
  kv: string
  bucket: string
}

// 3–42 characters, so "<name>-media" stays within R2's 63-character bucket names.
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/

export function nameProblem(name: string): string | null {
  return NAME_RE.test(name) ? null : 'Use 3 to 42 lower-case letters, numbers and dashes, starting and ending with a letter or number.'
}

/** The default name "nuxflow" gives the same names the manual install guide uses. */
export function installNames(name: string): InstallNames {
  const problem = nameProblem(name)
  if (problem) throw new Error(`"${name}" can't be the name: ${problem}`)
  return { worker: name, database: name, kv: `${name}-plugin-kv`, bucket: `${name}-media` }
}

// The placeholders wrangler.toml.example ships with. While any is left, the config still
// needs its Cloudflare resources; once none is, the script only deploys.
const KV_ID_PLACEHOLDER = 'your-kv-namespace-id'
const KV_PREVIEW_PLACEHOLDER = 'your-kv-preview-namespace-id'
const D1_ID_PLACEHOLDER = 'your-d1-database-id'

export function needsResources(configText: string): boolean {
  return [KV_ID_PLACEHOLDER, KV_PREVIEW_PLACEHOLDER, D1_ID_PLACEHOLDER].some(p => configText.includes(`"${p}"`))
}

export interface FillInput {
  names: InstallNames
  databaseId: string
  kvId: string
  /** Only for someone with several Cloudflare accounts, so later deploys pick the same one. */
  accountId?: string
}

/**
 * wrangler.toml (made from wrangler.toml.example) with this install's names and ids, edited
 * line by line so every explanatory comment stays — Wrangler's own write-back refuses a
 * .toml file with comments. Also switches on the two bindings that need nothing created
 * and are commented out only for the sake of local dev and CI: Workers AI and Analytics
 * Engine (visitor analytics).
 */
export function fillConfig(text: string, input: FillInput): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let out = text.replace(/\r\n/g, '\n')
  const { names } = input

  const replace = (re: RegExp, line: string, what: string) => {
    if (!re.test(out)) throw new Error(`Couldn't find ${what} in wrangler.toml. Start again from wrangler.toml.example, or fill it in by hand (docs/installation.md).`)
    out = out.replace(re, line)
  }
  replace(/^name = ".*"$/m, `name = "${names.worker}"`, 'the Worker name (name = "...")')
  if (input.accountId) {
    if (/^account_id = ".*"$/m.test(out)) out = out.replace(/^account_id = ".*"$/m, `account_id = "${input.accountId}"`)
    else out = out.replace(/^name = ".*"$/m, line => `${line}\naccount_id = "${input.accountId}"`)
  }
  replace(new RegExp(`^id = "${KV_ID_PLACEHOLDER}"$`, 'm'), `id = "${input.kvId}"`, 'the KV namespace id')
  // Local dev simulates KV whatever this says; the guide has always used the same id here.
  replace(new RegExp(`^preview_id = "${KV_PREVIEW_PLACEHOLDER}"$`, 'm'), `preview_id = "${input.kvId}"`, 'the KV preview id')
  replace(/^bucket_name = ".*"$/m, `bucket_name = "${names.bucket}"`, 'the R2 bucket name')
  replace(/^database_name = ".*"$/m, `database_name = "${names.database}"`, 'the D1 database name')
  replace(new RegExp(`^database_id = "${D1_ID_PLACEHOLDER}"$`, 'm'), `database_id = "${input.databaseId}"`, 'the D1 database id')

  out = out.replace(/^# \[ai\]\n# binding = "AI"$/m, '[ai]\nbinding = "AI"')
  out = out.replace(/^# \[\[analytics_engine_datasets\]\]\n# binding = "AE"\n# dataset = "(.*)"$/m, '[[analytics_engine_datasets]]\nbinding = "AE"\ndataset = "$1"')

  return eol === '\n' ? out : out.replace(/\n/g, eol)
}

/**
 * Checks the parsed result of fillConfig() says what it should, before anything is
 * deployed with it. Returns the problems found (empty = fine).
 */
export function configProblems(config: Record<string, unknown>, expect: { names: InstallNames; databaseId: string; kvId: string }): string[] {
  const problems: string[] = []
  const list = (key: string) => (Array.isArray(config[key]) ? config[key] : []) as Record<string, unknown>[]
  if (config.name !== expect.names.worker) problems.push(`name is "${String(config.name)}", not "${expect.names.worker}"`)
  const db = list('d1_databases').find(d => d.binding === 'DB')
  if (db?.database_id !== expect.databaseId) problems.push('the DB binding doesn\'t have the new database id')
  const kv = list('kv_namespaces').find(k => k.binding === 'PLUGIN_KV')
  if (kv?.id !== expect.kvId) problems.push('the PLUGIN_KV binding doesn\'t have the new namespace id')
  const r2 = list('r2_buckets').find(b => b.binding === 'MEDIA_BUCKET')
  if (r2?.bucket_name !== expect.names.bucket) problems.push('the MEDIA_BUCKET binding doesn\'t name the new bucket')
  return problems
}

export interface CloudflareAccount {
  id: string
  name: string
}

/** `wrangler whoami --json` → the accounts this login can use (empty when logged out). */
export function parseWhoami(output: string): { loggedIn: boolean; accounts: CloudflareAccount[] } {
  const start = output.indexOf('{')
  let parsed: { loggedIn?: unknown; accounts?: unknown }
  try {
    parsed = JSON.parse(start >= 0 ? output.slice(start) : output) as typeof parsed
  } catch {
    return { loggedIn: false, accounts: [] }
  }
  const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : [])
    .filter((a): a is { id: string; name?: unknown } => typeof (a as { id?: unknown })?.id === 'string')
    .map(a => ({ id: a.id, name: typeof a.name === 'string' ? a.name : a.id }))
  return { loggedIn: parsed.loggedIn === true, accounts }
}

/** The workers.dev address `wrangler deploy` printed, if it printed one. */
export function workersDevUrl(deployOutput: string): string | null {
  const matches = deployOutput.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/gi)
  return matches?.at(-1)?.toLowerCase() ?? null
}

/** Whether a failed deploy looks like the account isn't on the Workers Paid plan. */
export function looksLikeFreePlan(deployOutput: string): boolean {
  return /workers paid|paid plan|worker_loaders|dynamic workers|cpu_ms|limits\.cpu/i.test(deployOutput)
}
