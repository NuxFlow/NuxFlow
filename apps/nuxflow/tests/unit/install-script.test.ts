import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTOML } from 'confbox'
import {
  configProblems, fillConfig, installNames, looksLikeFreePlan, nameProblem, needsResources, parseInstallFlags, parseWhoami, workersDevUrl,
} from '../../scripts/install/lib'

// The real example file: an edit to it that the install script can't follow fails here.
const example = readFileSync(join(__dirname, '../../wrangler.toml.example'), 'utf8')
const D1 = '11111111-2222-3333-4444-555555555555'
const KV = 'a'.repeat(32)
const ACCOUNT = 'b'.repeat(32)

type Toml = Record<string, unknown> & {
  d1_databases: { binding: string; database_name: string; database_id: string }[]
  kv_namespaces: { binding: string; id: string; preview_id: string }[]
  r2_buckets: { binding: string; bucket_name: string }[]
  analytics_engine_datasets?: { binding: string; dataset: string }[]
  ai?: { binding: string }
}

describe('install flags and names', () => {
  it('reads the options and refuses unknown ones', () => {
    expect(parseInstallFlags(['--name', 'mysite', '--location=weur', '--yes'])).toEqual({ name: 'mysite', location: 'weur', dryRun: false, yes: true, help: false })
    expect(parseInstallFlags(['--dry-run']).dryRun).toBe(true)
    expect(() => parseInstallFlags(['--location', 'mars'])).toThrow(/--location/)
    expect(() => parseInstallFlags(['--ring', '1'])).toThrow(/Unknown option/)
    expect(() => parseInstallFlags(['--name'])).toThrow(/needs a value/)
  })

  it('names everything after the Worker; the default matches the manual guide', () => {
    expect(installNames('nuxflow')).toEqual({ worker: 'nuxflow', database: 'nuxflow', kv: 'nuxflow-plugin-kv', bucket: 'nuxflow-media' })
    expect(nameProblem('My Site')).not.toBeNull()
    expect(nameProblem('-site')).not.toBeNull()
    expect(nameProblem('ab')).not.toBeNull()
    // "<name>-media" must stay a valid R2 bucket name (63 characters at most).
    expect(nameProblem('a'.repeat(43))).not.toBeNull()
    expect(installNames('a'.repeat(42)).bucket.length).toBeLessThanOrEqual(63)
  })
})

describe('filling in wrangler.toml', () => {
  const names = installNames('mysite')

  it('knows the example still needs its resources, and a filled one does not', () => {
    expect(needsResources(example)).toBe(true)
    expect(needsResources(fillConfig(example, { names, databaseId: D1, kvId: KV }))).toBe(false)
  })

  it('sets the names and ids, switches on AI and analytics, and keeps every comment', () => {
    const filled = fillConfig(example, { names, databaseId: D1, kvId: KV })
    const config = parseTOML(filled) as Toml
    expect(config.name).toBe('mysite')
    expect(config.account_id).toBeUndefined()
    expect(config.d1_databases).toEqual([{ binding: 'DB', database_name: 'mysite', database_id: D1 }])
    expect(config.kv_namespaces).toEqual([{ binding: 'PLUGIN_KV', id: KV, preview_id: KV }])
    expect(config.r2_buckets).toEqual([{ binding: 'MEDIA_BUCKET', bucket_name: 'mysite-media' }])
    expect(config.ai).toEqual({ binding: 'AI' })
    expect(config.analytics_engine_datasets).toEqual([{ binding: 'AE', dataset: 'nuxflow_analytics' }])
    // Untouched: everything else, including bindings that need nothing created.
    const before = parseTOML(example) as Toml
    expect(config.worker_loaders).toEqual(before.worker_loaders)
    expect(config.send_email).toEqual(before.send_email)
    expect(config.triggers).toEqual(before.triggers)
    expect(config.vectorize).toBeUndefined()
    const comments = (t: string) => t.split('\n').filter(l => l.startsWith('#') && !/^# (?:\[|binding|dataset)/.test(l))
    expect(comments(filled)).toEqual(comments(example))
    expect(configProblems(config, { names, databaseId: D1, kvId: KV })).toEqual([])
  })

  it('adds the account only when one was chosen, before any table', () => {
    const config = parseTOML(fillConfig(example, { names, databaseId: D1, kvId: KV, accountId: ACCOUNT })) as Toml
    expect(config.account_id).toBe(ACCOUNT)
  })

  it('keeps Windows line endings', () => {
    const filled = fillConfig(example.replace(/\r?\n/g, '\r\n'), { names, databaseId: D1, kvId: KV })
    expect(filled.split('\r\n').length).toBe(filled.split('\n').length)
    expect((parseTOML(filled) as Toml).d1_databases[0]!.database_id).toBe(D1)
  })

  it('stops when the file has been changed beyond recognition', () => {
    expect(() => fillConfig(example.replace('database_id = "your-d1-database-id"', ''), { names, databaseId: D1, kvId: KV })).toThrow(/D1 database id/)
  })

  it('reports a config that does not say what it should', () => {
    const config = parseTOML(fillConfig(example, { names, databaseId: D1, kvId: KV })) as Toml
    expect(configProblems(config, { names: installNames('other'), databaseId: 'x', kvId: KV })).toHaveLength(3)
  })
})

describe('reading Wrangler output', () => {
  it('reads the accounts from wrangler whoami --json, banner or not', () => {
    const out = `⛅️ wrangler 4.157.0\n${JSON.stringify({ loggedIn: true, accounts: [{ id: ACCOUNT, name: 'Mine' }, { id: 'x'.repeat(32) }, { name: 'no id' }] })}`
    expect(parseWhoami(out)).toEqual({ loggedIn: true, accounts: [{ id: ACCOUNT, name: 'Mine' }, { id: 'x'.repeat(32), name: 'x'.repeat(32) }] })
    expect(parseWhoami('You are not authenticated. Please run `wrangler login`.')).toEqual({ loggedIn: false, accounts: [] })
  })

  it('finds the workers.dev address in the deploy output', () => {
    expect(workersDevUrl('Uploaded mysite (12.3 sec)\nDeployed mysite triggers\n  https://mysite.someone.workers.dev\n  schedule: * * * * *')).toBe('https://mysite.someone.workers.dev')
    expect(workersDevUrl('Deployed mysite triggers\n  example.com/*')).toBeNull()
  })

  it('spots a deploy refused for want of the Paid plan', () => {
    expect(looksLikeFreePlan('✘ [ERROR] A request to the Cloudflare API failed. worker_loaders requires a Workers Paid plan')).toBe(true)
    expect(looksLikeFreePlan('✘ [ERROR] Build failed with 1 error')).toBe(false)
  })
})
