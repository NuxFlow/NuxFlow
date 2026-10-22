// pnpm pool:create — the pure logic (no Cloudflare, no files), unit-tested in
// tests/unit/pool-scripts.test.ts. A member pool is a hosting platform's extra Worker + D1
// for some of its sites (server/utils/control-plane.ts); its wrangler config is the
// control plane's own config with its own name, D1 and KV, no routes, and NUXT_POOL_ID.
import { POOL_ID_RE, poolBindingName } from '../../shared/lib/pool-id'

export interface PoolNames {
  worker: string
  database: string
  kv: string
  /** Wrangler config file in apps/nuxflow. */
  config: string
}

export function poolNames(poolId: string): PoolNames {
  if (!POOL_ID_RE.test(poolId)) {
    throw new Error(`"${poolId}" can't be a pool name: use lower-case letters, digits and dashes (up to 31), starting with a letter or digit.`)
  }
  return {
    worker: `nuxflow-pool-${poolId}`,
    database: `nuxflow-pool-${poolId}`,
    kv: `nuxflow-pool-${poolId}-plugin-kv`,
    config: `wrangler.pool-${poolId}.jsonc`,
  }
}

type Config = Record<string, unknown>

/**
 * The pool's wrangler config, from the control plane's. Shared with the control plane:
 * the R2 bucket (media keys are `<siteId>/…`, so pools can share it and a site can move
 * pool without copying files), Analytics Engine, Vectorize, Workers AI, email sending,
 * crons and limits. Its own: the Worker name, D1, KV and the pool's id. Taken away:
 * routes (traffic reaches a pool only through the platform's router) and the
 * workers.dev / preview addresses.
 */
export function buildPoolConfig(base: Config, input: { poolId: string; databaseId: string; kvId: string }): Config {
  const names = poolNames(input.poolId)
  const config = structuredClone(base)

  const vars = { ...((config.vars as Config | undefined) ?? {}) }
  if (!vars.NUXT_PUBLIC_ACCOUNTS_URL) {
    throw new Error('The control plane\'s config has no NUXT_PUBLIC_ACCOUNTS_URL. Pools sign people in through the control plane, so it needs central sign-in first.')
  }
  delete vars.NUXT_PUBLIC_SITE_URL // the control plane's own address; a pool has none
  vars.NUXT_POOL_ID = input.poolId

  const d1 = Array.isArray(config.d1_databases) ? config.d1_databases as Config[] : []
  if (!d1.some(db => db.binding === 'DB')) throw new Error('The control plane\'s config has no D1 database with binding "DB".')
  const kv = Array.isArray(config.kv_namespaces) ? config.kv_namespaces as Config[] : []
  if (!kv.some(ns => ns.binding === 'PLUGIN_KV')) throw new Error('The control plane\'s config has no KV namespace with binding "PLUGIN_KV".')

  delete config.routes
  delete config.route
  // Per-environment overrides could bring routes or bindings back.
  delete config.env

  // The control plane's own bindings to its pools stay with it (a pool talks only to its
  // control plane); the pool gets one back to the control plane, for sign-in.
  const otherServices = (Array.isArray(config.services) ? config.services as Config[] : [])
    .filter(s => typeof s.binding !== 'string' || (!s.binding.startsWith('POOL_') && s.binding !== 'CONTROL_PLANE'))
  if (typeof base.name !== 'string' || !base.name) throw new Error('The control plane\'s config has no Worker name.')

  return {
    ...config,
    name: names.worker,
    workers_dev: false,
    preview_urls: false,
    vars,
    services: [...otherServices, { binding: 'CONTROL_PLANE', service: base.name, entrypoint: 'NuxflowControlPlane' }],
    d1_databases: d1.map(db => db.binding === 'DB'
      ? { binding: 'DB', database_name: names.database, database_id: input.databaseId }
      : db),
    kv_namespaces: kv.map(ns => ns.binding === 'PLUGIN_KV' ? { binding: 'PLUGIN_KV', id: input.kvId } : ns),
  }
}

/** The file written for the pool: JSONC with a note on where it came from. */
export function poolConfigFile(config: Config, input: { poolId: string; from: string }): string {
  return `// Member pool "${input.poolId}", made by \`pnpm pool:create\` from ${input.from}.
// Gitignored like the other wrangler configs. Deployed by pnpm ring:canary / ring:promote.
${JSON.stringify(config, null, 2)}
`
}

/**
 * What connects the pool to its control plane (server/utils/pools.ts): a service binding
 * in the control plane's wrangler.toml to the pool's private admin entrypoint.
 */
export function serviceBindingBlock(poolId: string): string {
  return `[[services]]
binding = "${poolBindingName(poolId)}"
service = "${poolNames(poolId).worker}"
entrypoint = "NuxflowPoolAdmin"`
}

/**
 * What lets the front-door router (packages/router) send the pool's addresses to it: a
 * service binding to the pool's normal fetch handler, so no entrypoint.
 */
export function routerBindingBlock(poolId: string): string {
  return `[[services]]
binding = "${poolBindingName(poolId)}"
service = "${poolNames(poolId).worker}"`
}

/** The id of a D1 database by name, from `wrangler d1 list --json`. */
export function findD1Id(listJson: string, name: string): string | null {
  const list = parseList(listJson, 'wrangler d1 list')
  const match = list.find(db => db.name === name)
  return typeof match?.uuid === 'string' ? match.uuid : null
}

/** The id of a KV namespace by title, from `wrangler kv namespace list`. */
export function findKvId(listJson: string, title: string): string | null {
  const list = parseList(listJson, 'wrangler kv namespace list')
  const match = list.find(ns => ns.title === title)
  return typeof match?.id === 'string' ? match.id : null
}

/** Whether a Worker already has a secret, from `wrangler secret list --format json`. */
export function hasSecret(listJson: string, name: string): boolean {
  return parseList(listJson, 'wrangler secret list').some(s => s.name === name)
}

function parseList(json: string, what: string): Config[] {
  // Wrangler may print a banner or warnings before the JSON.
  const start = json.indexOf('[')
  try {
    const parsed: unknown = JSON.parse(start >= 0 ? json.slice(start) : json)
    if (Array.isArray(parsed)) return parsed as Config[]
  } catch {
    // reported below
  }
  throw new Error(`Couldn't read the output of ${what}:\n${json.slice(0, 500)}`)
}

/**
 * release-targets.json with the pool added (unchanged if it's already there), so the
 * ring scripts deploy it from now on.
 */
export function addPoolTarget(targetsJson: string, target: { name: string; ring: 1 | 2; config: string }): { json: string; added: boolean } {
  const file = JSON.parse(targetsJson) as { targets?: Config[] }
  const targets = Array.isArray(file.targets) ? file.targets : []
  if (targets.some(t => t.config === target.config)) return { json: targetsJson, added: false }
  if (targets.some(t => t.name === target.name)) throw new Error(`release-targets.json already has a target called "${target.name}".`)
  return { json: `${JSON.stringify({ ...file, targets: [...targets, target] }, null, 2)}\n`, added: true }
}

export interface PoolFlags {
  poolId: string | null
  ring: 1 | 2
  from: string
  location: string | null
  dryRun: boolean
  yes: boolean
  help: boolean
}

// D1's location hints (wrangler d1 create --help).
const LOCATIONS = new Set(['weur', 'eeur', 'apac', 'oc', 'wnam', 'enam'])

export function parsePoolFlags(argv: readonly string[]): PoolFlags {
  const flags: PoolFlags = { poolId: null, ring: 2, from: 'wrangler.toml', location: null, dryRun: false, yes: false, help: false }
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
      case '--ring': {
        const ring = value()
        if (ring !== '1' && ring !== '2') throw new Error('--ring must be 1 or 2.')
        flags.ring = ring === '1' ? 1 : 2
        break
      }
      case '--from': flags.from = value(); break
      case '--location': {
        const location = value()
        if (!LOCATIONS.has(location)) throw new Error(`--location must be one of: ${[...LOCATIONS].join(', ')}.`)
        flags.location = location
        break
      }
      default:
        if (arg.startsWith('-') || flags.poolId !== null) throw new Error(`Unknown option: ${arg}`)
        flags.poolId = arg
    }
  }
  return flags
}
