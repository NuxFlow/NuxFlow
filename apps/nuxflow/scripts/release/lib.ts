// Release rings — the pure logic behind canary.ts, promote.ts and status.ts (no git, no
// network, no files), so it can be unit-tested (tests/unit/release-scripts.test.ts).
//
// A release is a git tag: `ring1-YYYY-MM-DD` when a commit goes to the ring 1 deployments
// (the operator's own sites), `ring2-YYYY-MM-DD` when that same commit is promoted to
// every ring 2 deployment (customers) after it has run on ring 1 for MIN_SOAK_HOURS.
// The deployments themselves are listed in release-targets.json (gitignored — it names
// the operator's own wrangler config files; release-targets.example.json shows the shape).

export type Ring = 1 | 2

export interface ReleaseTarget {
  /** Shown in messages, e.g. "nuxflow.cloud". */
  name: string
  ring: Ring
  /** Wrangler config file in apps/nuxflow, e.g. "wrangler.cloud.toml". */
  config: string
  /** A public page checked after deploying (status + page cache). Optional. */
  checkUrl?: string
}

export interface RingTag {
  name: string
  commit: string
  createdAt: Date
}

export const RING1_PREFIX = 'ring1-'
export const RING2_PREFIX = 'ring2-'
export const MIN_SOAK_HOURS = 48
export const TARGETS_FILE = 'release-targets.json'
export const MIGRATIONS_DIR = 'packages/db/migrations'

// A bare file name: the config always lives next to package.json in apps/nuxflow.
const CONFIG_NAME_RE = /^[\w.-]+\.(?:toml|json|jsonc)$/

/**
 * Reads release-targets.json. Throws a message meant for the operator, never a stack
 * trace, so a typo in the file is easy to fix on a tired day.
 */
export function parseTargets(raw: string, configExists: (file: string) => boolean): ReleaseTarget[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${TARGETS_FILE} isn't valid JSON: ${(err as Error).message}`, { cause: err })
  }
  const list = (parsed as { targets?: unknown })?.targets
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${TARGETS_FILE} needs a "targets" list with at least one deployment.`)
  }
  const names = new Set<string>()
  const targets = list.map((item: unknown, i): ReleaseTarget => {
    const t = (item ?? {}) as Record<string, unknown>
    const where = `${TARGETS_FILE}, target ${i + 1}`
    if (typeof t.name !== 'string' || !t.name.trim()) throw new Error(`${where}: "name" is missing.`)
    const name = t.name.trim()
    if (names.has(name)) throw new Error(`${where}: the name "${name}" is used twice.`)
    names.add(name)
    if (t.ring !== 1 && t.ring !== 2) throw new Error(`${where} (${name}): "ring" must be 1 or 2.`)
    if (typeof t.config !== 'string' || !CONFIG_NAME_RE.test(t.config)) {
      throw new Error(`${where} (${name}): "config" must be a wrangler file name in apps/nuxflow, like "wrangler.cloud.toml".`)
    }
    if (!configExists(t.config)) throw new Error(`${where} (${name}): apps/nuxflow/${t.config} doesn't exist.`)
    let checkUrl: string | undefined
    if (t.checkUrl !== undefined && t.checkUrl !== '') {
      if (typeof t.checkUrl !== 'string' || !/^https?:\/\//.test(t.checkUrl)) {
        throw new Error(`${where} (${name}): "checkUrl" must start with https://`)
      }
      checkUrl = t.checkUrl
    }
    return { name, ring: t.ring, config: t.config, checkUrl }
  })
  if (!targets.some(t => t.ring === 1)) {
    throw new Error(`${TARGETS_FILE} has no ring 1 deployment. Ring 1 always gets new code first.`)
  }
  return targets
}

/** YYYY-MM-DD in the operator's own time zone (tags are named after the day they deploy). */
export function localDateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `ring1-2026-10-22`, or `ring1-2026-10-22-2` for a second release the same day. */
export function nextTagName(prefix: string, date: Date, existing: readonly string[]): string {
  const base = `${prefix}${localDateStamp(date)}`
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
}

/** The format string gitTagList() passes to `git for-each-ref`; parseTagList() reads it. */
export const TAG_LIST_FORMAT = '%(refname:short)%09%(objecttype)%09%(*objectname)%09%(objectname)%09%(taggerdate:unix)%09%(committerdate:unix)'

/**
 * Parses `git for-each-ref --format=TAG_LIST_FORMAT refs/tags/ring*`. Annotated tags
 * (what the scripts create) carry their own creation time; a plain tag made by hand
 * falls back to its commit's time.
 */
export function parseTagList(output: string): RingTag[] {
  const tags: RingTag[] = []
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name, type, peeled, object, taggerDate, committerDate] = line.split('\t')
    const annotated = type === 'tag'
    const commit = annotated ? peeled : object
    const seconds = Number(annotated ? taggerDate : committerDate)
    if (!name || !commit || !Number.isFinite(seconds) || seconds <= 0) continue
    tags.push({ name, commit, createdAt: new Date(seconds * 1000) })
  }
  return tags
}

export function tagsWithPrefix(tags: readonly RingTag[], prefix: string): RingTag[] {
  return tags
    .filter(t => t.name.startsWith(prefix))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.name.localeCompare(a.name))
}

export function newestTag(tags: readonly RingTag[], prefix: string): RingTag | null {
  return tagsWithPrefix(tags, prefix)[0] ?? null
}

export interface SoakStatus {
  ready: boolean
  hoursWaited: number
  hoursLeft: number
}

/** Has a ring 1 release run long enough to be promoted? */
export function soakStatus(createdAt: Date, now: Date, minHours = MIN_SOAK_HOURS): SoakStatus {
  const hoursWaited = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000)
  return { ready: hoursWaited >= minHours, hoursWaited, hoursLeft: Math.max(0, minHours - hoursWaited) }
}

/** "2 days 5 hours", "3 hours", "less than an hour". */
export function formatHours(hours: number): string {
  const whole = Math.floor(hours)
  if (whole < 1) return 'less than an hour'
  const days = Math.floor(whole / 24)
  const rest = whole % 24
  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (rest) parts.push(`${rest} hour${rest === 1 ? '' : 's'}`)
  return parts.join(' ')
}

/** Migration files a release adds or changes, from `git diff --name-only … -- MIGRATIONS_DIR`. */
export function migrationFiles(diffNameOnly: string): string[] {
  return diffNameOnly
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith(`${MIGRATIONS_DIR}/`) && line.endsWith('.sql'))
}

/** A row for the release log table in MYSTUFF/plan/14-canary-sites-now.md. */
export function releaseLogLine(input: { date: Date; tag: string; dbChange: boolean | null; promoted?: string }): string {
  const db = input.dbChange === null ? '?' : input.dbChange ? 'yes' : 'no'
  const cells = [localDateStamp(input.date), input.tag, db, '', input.promoted ?? '']
  return `|${cells.map(c => (c ? ` ${c} ` : ' ')).join('|')}|`
}

export interface ReleaseFlags {
  dryRun: boolean
  yes: boolean
  urgent: boolean
  tag: string | null
  help: boolean
}

/** The few flags the scripts take; anything else is refused rather than ignored. */
export function parseFlags(argv: readonly string[], allowed: readonly (keyof ReleaseFlags)[]): ReleaseFlags {
  const flags: ReleaseFlags = { dryRun: false, yes: false, urgent: false, tag: null, help: false }
  const names: Record<string, keyof ReleaseFlags> = {
    '--dry-run': 'dryRun',
    '--yes': 'yes',
    '--urgent': 'urgent',
    '--tag': 'tag',
    '--help': 'help',
    '-h': 'help',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') continue
    const [flag, inline] = arg.split('=', 2) as [string, string | undefined]
    const key = names[flag]
    if (!key || (key !== 'help' && !allowed.includes(key))) throw new Error(`Unknown option: ${arg}`)
    if (key === 'tag') {
      const value = inline ?? argv[++i]
      if (!value || !value.startsWith(RING1_PREFIX)) throw new Error('--tag needs a ring 1 tag name, like --tag ring1-2026-10-22')
      flags.tag = value
    } else {
      flags[key] = true
    }
  }
  return flags
}
