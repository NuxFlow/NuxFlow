import { describe, expect, it } from 'vitest'
import {
  addPoolTarget, buildPoolConfig, findD1Id, findKvId, hasSecret, parsePoolFlags, poolConfigFile, poolNames, serviceBindingBlock,
} from '../../scripts/pools/lib'

const base = {
  name: 'nuxflow-cloud',
  main: '.output/server/index.mjs',
  workers_dev: true,
  routes: [{ pattern: 'nuxflow.cloud/*', zone_name: 'nuxflow.cloud' }],
  env: { staging: { routes: [{ pattern: 'staging.nuxflow.cloud/*' }] } },
  vars: { NUXT_PUBLIC_SITE_URL: 'https://nuxflow.cloud', NUXT_PUBLIC_ACCOUNTS_URL: 'https://accounts.nuxflow.cloud', NUXT_ANALYTICS_DATASET: 'nuxflow_analytics' },
  d1_databases: [{ binding: 'DB', database_name: 'nuxflow-cloud', database_id: 'cloud-db-id' }],
  kv_namespaces: [{ binding: 'PLUGIN_KV', id: 'cloud-kv-id', preview_id: 'cloud-kv-preview' }],
  r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: 'nuxflow-cloud-media' }],
  triggers: { crons: ['* * * * *'] },
}

describe('poolNames', () => {
  it('builds every name from the pool id', () => {
    expect(poolNames('clientx')).toEqual({
      worker: 'nuxflow-pool-clientx',
      database: 'nuxflow-pool-clientx',
      kv: 'nuxflow-pool-clientx-plugin-kv',
      config: 'wrangler.pool-clientx.jsonc',
    })
  })

  it.each(['Client', 'client x', '-client', '../x', 'a'.repeat(32)])('refuses %j', (id) => {
    expect(() => poolNames(id)).toThrow(/can't be a pool name/)
  })
})

describe('buildPoolConfig', () => {
  const pool = buildPoolConfig(base, { poolId: 'clientx', databaseId: 'pool-db-id', kvId: 'pool-kv-id' })

  it('gives the pool its own Worker, D1 and KV', () => {
    expect(pool.name).toBe('nuxflow-pool-clientx')
    expect(pool.d1_databases).toEqual([{ binding: 'DB', database_name: 'nuxflow-pool-clientx', database_id: 'pool-db-id' }])
    expect(pool.kv_namespaces).toEqual([{ binding: 'PLUGIN_KV', id: 'pool-kv-id' }])
  })

  it('marks it as a pool that signs in through the control plane', () => {
    expect(pool.vars).toEqual({ NUXT_PUBLIC_ACCOUNTS_URL: 'https://accounts.nuxflow.cloud', NUXT_ANALYTICS_DATASET: 'nuxflow_analytics', NUXT_POOL_ID: 'clientx' })
  })

  it('leaves it unreachable except through the platform\'s router', () => {
    expect(pool.routes).toBeUndefined()
    expect(pool.env).toBeUndefined()
    expect(pool.workers_dev).toBe(false)
    expect(pool.preview_urls).toBe(false)
  })

  it('shares everything else with the control plane, including the R2 bucket', () => {
    expect(pool.r2_buckets).toEqual(base.r2_buckets)
    expect(pool.triggers).toEqual(base.triggers)
    expect(pool.main).toBe(base.main)
  })

  it('never changes the control plane\'s own config', () => {
    expect(base.name).toBe('nuxflow-cloud')
    expect(base.d1_databases[0]!.database_id).toBe('cloud-db-id')
    expect(base.routes).toHaveLength(1)
  })

  it.each([
    [{ ...base, vars: {} }, /NUXT_PUBLIC_ACCOUNTS_URL/],
    [{ ...base, d1_databases: [] }, /binding "DB"/],
    [{ ...base, kv_namespaces: [] }, /binding "PLUGIN_KV"/],
  ])('refuses a control plane config that can\'t run a pool (%#)', (config, message) => {
    expect(() => buildPoolConfig(config, { poolId: 'clientx', databaseId: 'd', kvId: 'k' })).toThrow(message)
  })

  it('writes JSONC with a note on where it came from', () => {
    const file = poolConfigFile(pool, { poolId: 'clientx', from: 'wrangler.cloud.toml' })
    expect(file.startsWith('// Member pool "clientx"')).toBe(true)
    expect(JSON.parse(file.split('\n').filter(l => !l.startsWith('//')).join('\n')).name).toBe('nuxflow-pool-clientx')
  })
})

describe('serviceBindingBlock', () => {
  it('connects the control plane to the pool\'s private admin entrypoint', () => {
    expect(serviceBindingBlock('eu-1')).toBe(`[[services]]
binding = "POOL_EU_1"
service = "nuxflow-pool-eu-1"
entrypoint = "NuxflowPoolAdmin"`)
  })
})

describe('wrangler listings', () => {
  it('finds a D1 database by name', () => {
    const list = JSON.stringify([{ uuid: 'u1', name: 'nuxflow' }, { uuid: 'u2', name: 'nuxflow-pool-clientx' }])
    expect(findD1Id(list, 'nuxflow-pool-clientx')).toBe('u2')
    expect(findD1Id(list, 'nuxflow-pool-other')).toBeNull()
  })

  it('finds a KV namespace by title, past a banner wrangler printed first', () => {
    const list = `⛅️ wrangler 4.151.1\n${JSON.stringify([{ id: 'k1', title: 'nuxflow-pool-clientx-plugin-kv' }])}`
    expect(findKvId(list, 'nuxflow-pool-clientx-plugin-kv')).toBe('k1')
  })

  it('reads secret names', () => {
    expect(hasSecret('[{"name":"NUXT_BETTER_AUTH_SECRET","type":"secret_text"}]', 'NUXT_BETTER_AUTH_SECRET')).toBe(true)
    expect(hasSecret('[]', 'NUXT_BETTER_AUTH_SECRET')).toBe(false)
  })

  it('stops on output it can\'t read rather than guessing', () => {
    expect(() => findD1Id('Not logged in.', 'x')).toThrow(/Couldn't read the output of wrangler d1 list/)
  })
})

describe('addPoolTarget', () => {
  const file = JSON.stringify({ $comment: 'mine', targets: [{ name: 'nuxflow.dev', ring: 1, config: 'wrangler.toml' }] })

  it('adds the pool so the ring scripts deploy it, keeping the rest of the file', () => {
    const { json, added } = addPoolTarget(file, { name: 'pool:clientx', ring: 2, config: 'wrangler.pool-clientx.jsonc' })
    expect(added).toBe(true)
    expect(JSON.parse(json)).toEqual({
      $comment: 'mine',
      targets: [
        { name: 'nuxflow.dev', ring: 1, config: 'wrangler.toml' },
        { name: 'pool:clientx', ring: 2, config: 'wrangler.pool-clientx.jsonc' },
      ],
    })
  })

  it('leaves the file alone when the pool is already there', () => {
    const once = addPoolTarget(file, { name: 'pool:clientx', ring: 2, config: 'wrangler.pool-clientx.jsonc' }).json
    expect(addPoolTarget(once, { name: 'pool:clientx', ring: 2, config: 'wrangler.pool-clientx.jsonc' })).toEqual({ json: once, added: false })
  })
})

describe('parsePoolFlags', () => {
  it('reads the name and options', () => {
    expect(parsePoolFlags(['clientx', '--ring', '1', '--from=wrangler.cloud.toml', '--location', 'weur', '--yes'])).toEqual({
      poolId: 'clientx', ring: 1, from: 'wrangler.cloud.toml', location: 'weur', dryRun: false, yes: true, help: false,
    })
  })

  it('defaults to ring 2 and wrangler.toml', () => {
    expect(parsePoolFlags(['clientx'])).toMatchObject({ ring: 2, from: 'wrangler.toml', location: null })
  })

  it.each([
    [['clientx', 'second'], /Unknown option: second/],
    [['clientx', '--ring', '3'], /--ring must be 1 or 2/],
    [['clientx', '--location', 'mars'], /--location must be one of/],
    [['clientx', '--from'], /--from needs a value/],
    [['--urgent'], /Unknown option/],
  ])('refuses %j', (argv, message) => {
    expect(() => parsePoolFlags(argv)).toThrow(message)
  })
})
