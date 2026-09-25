/**
 * Integration tests for the routes that serve third-party dynamic-plugin code — the
 * sandbox boundary described in CLAUDE.md's "Plugin system" section:
 *   /_nuxflow/ext/:pluginId/*            (server module proxy via the LOADER binding)
 *   /_nuxflow/plugin-bundle/:id          (client bundle, loaded inside the iframe)
 *   /_nuxflow/plugin-frame/:pluginId/*   (the sandboxed iframe document)
 * plus server/utils/cf-plugin-kv.ts, exercised for real against fake KV/LOADER bindings.
 *
 * Invariants:
 *  - Plugins are looked up per site; inactive/unknown plugins are never served.
 *  - Code is served/executed only when its SHA-256 matches the checksum recorded at
 *    install — missing checksum or tampered KV content fails closed.
 *  - The ext proxy never forwards Cookie/Authorization to plugin code, and every
 *    response is confined (no Set-Cookie, forced CSP sandbox).
 *  - Spawned workers get no outbound network and bounded CPU/subrequests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite } from '../helpers/seed'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { computeSha256 } from '../../server/utils/plugin-signing'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// h3's send() isn't among the global stubs — it just returns the body in tests.
globalThis.send = ((_event: unknown, data: unknown) => data) as never

const { default: extHandler } = await import('../../server/routes/_nuxflow/ext/[pluginId]/[...path]')
const { default: bundleHandler } = await import('../../server/routes/_nuxflow/plugin-bundle/[id]')
const { default: frameHandler } = await import('../../server/routes/_nuxflow/plugin-frame/[pluginId]/[...blockName].get')
const cfPluginKv = await import('../../server/utils/cf-plugin-kv')

type Handler = (e: H3Event) => Promise<unknown>

const SITE = 'site-plugin-serve-01'
const OTHER = 'site-plugin-serve-02'
const SERVER_CODE = 'export default { fetch() { return new Response("hi") } }'
const CLIENT_CODE = 'export function renderBlock() { return null }'

// ── Fake bindings ────────────────────────────────────────────────────────────
const kvStore = new Map<string, string>()
const kv = {
  get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
  put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v) }),
  delete: vi.fn(async (k: string) => { kvStore.delete(k) }),
}

let lastWorkerCode: Record<string, unknown> | null = null
let lastForwarded: Request | null = null
let pluginResponse: () => Response = () => new Response('ok')
const loader = {
  get: vi.fn((_id: string, getCode: () => Promise<Record<string, unknown>>) => ({
    getEntrypoint: vi.fn((_name: unknown, _opts: unknown) => ({
      fetch: async (req: Request) => {
        lastWorkerCode = await getCode()
        lastForwarded = req
        return pluginResponse()
      },
    })),
  })),
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'plugins.localhost' })
  await seedSite(db, { id: OTHER, domain: 'plugins2.localhost' })

  const serverChecksum = await computeSha256(SERVER_CODE)
  const clientChecksum = await computeSha256(CLIENT_CODE)
  await db.insert(dynamicPlugins).values([
    {
      id: 'com.ok', siteId: SITE, name: 'OK', version: '1.0.0', isActive: true,
      hasServer: true, hasClient: true, serverChecksum, clientChecksum,
      blockDefinitions: [{ id: 'com.ok/card' }],
    },
    { id: 'com.inactive', siteId: SITE, name: 'Off', version: '1.0.0', isActive: false, hasServer: true, hasClient: true, serverChecksum, clientChecksum },
    { id: 'com.nochecksum', siteId: SITE, name: 'NC', version: '1.0.0', isActive: true, hasServer: true, hasClient: true },
    { id: 'com.tampered', siteId: SITE, name: 'T', version: '1.0.0', isActive: true, hasServer: true, hasClient: true, serverChecksum, clientChecksum },
    { id: 'com.foreign', siteId: OTHER, name: 'F', version: '1.0.0', isActive: true, hasServer: true, hasClient: true, serverChecksum, clientChecksum },
  ])

  for (const id of ['com.ok', 'com.nochecksum', 'com.inactive']) {
    kvStore.set(`plugin:${SITE}:${id}:server`, SERVER_CODE)
    kvStore.set(`plugin:${SITE}:${id}:client`, CLIENT_CODE)
  }
  kvStore.set(`plugin:${SITE}:com.tampered:server`, SERVER_CODE + '\n// injected')
  kvStore.set(`plugin:${SITE}:com.tampered:client`, CLIENT_CODE + '\n// injected')
})

afterAll(teardownTestDb)
beforeEach(() => {
  lastWorkerCode = null
  lastForwarded = null
  pluginResponse = () => new Response('ok')
  loader.get.mockClear()
})

function ev(opts: {
  siteId?: string; params?: Record<string, string>; path?: string; method?: string
  headers?: Record<string, string>; rawBody?: string; bindings?: boolean
} = {}) {
  const e = createMockEvent({
    siteId: opts.siteId ?? SITE,
    params: opts.params,
    path: opts.path,
    method: opts.method,
    headers: { host: 'plugins.localhost', ...opts.headers },
    rawBody: opts.rawBody,
  }) as unknown as H3Event & { method: string; context: Record<string, unknown> }
  e.method = opts.method ?? 'GET'
  if (opts.bindings !== false) e.context.cloudflare = { env: { PLUGIN_KV: kv, LOADER: loader } }
  return e as unknown as H3Event
}

describe('cf-plugin-kv', () => {
  it('reads and writes plugin code under site-scoped keys, and deletes both artifacts', async () => {
    const e = ev()
    await cfPluginKv.putPluginServerCode(e, 's1', 'p1', 'srv')
    await cfPluginKv.putPluginClientBundle(e, 's1', 'p1', 'cli')
    expect(kvStore.get('plugin:s1:p1:server')).toBe('srv')
    expect(await cfPluginKv.getPluginClientBundle(e, 's1', 'p1')).toBe('cli')
    expect(await cfPluginKv.getPluginServerCode(e, 's2', 'p1')).toBeNull()
    await cfPluginKv.deletePluginAssets(e, 's1', 'p1')
    expect(kvStore.has('plugin:s1:p1:server')).toBe(false)
    expect(kvStore.has('plugin:s1:p1:client')).toBe(false)
  })

  it('spawns workers with no outbound network, no env, and bounded limits', async () => {
    const stub = cfPluginKv.spawnPluginWorker(ev(), 'cache-1', async () => 'code')
    await stub.getEntrypoint(undefined, {} as never).fetch(new Request('https://x/'))
    expect(lastWorkerCode).toMatchObject({
      mainModule: 'index.js',
      modules: { 'index.js': 'code' },
      globalOutbound: null,
      limits: cfPluginKv.PLUGIN_WORKER_LIMITS,
    })
    expect(lastWorkerCode).not.toHaveProperty('env')
    expect(cfPluginKv.PLUGIN_WORKER_LIMITS.cpuMs).toBeLessThanOrEqual(50)
  })
})

describe('/_nuxflow/ext/:pluginId/*', () => {
  const extEv = (pluginId: string, extra: Parameters<typeof ev>[0] = {}) =>
    ev({ params: { pluginId }, path: `/_nuxflow/ext/${pluginId}/api/items?x=1`, ...extra })

  it('answers CORS preflight without touching the plugin', async () => {
    const e = extEv('com.ok', { method: 'OPTIONS' })
    expect(await (extHandler as Handler)(e)).toBeNull()
    expect((e as unknown as { _status: number })._status).toBe(204)
    expect(loader.get).not.toHaveBeenCalled()
  })

  it('proxies to the plugin with the sub-path and only allow-listed headers', async () => {
    const res = await (extHandler as Handler)(extEv('com.ok', {
      headers: { cookie: 'session=secret', authorization: 'Bearer nx_key', accept: 'application/json', 'user-agent': 'UA' },
    })) as Response

    expect(await res.text()).toBe('ok')
    expect(lastForwarded?.url).toBe('https://plugin.internal/api/items?x=1')
    expect(lastForwarded?.headers.get('cookie')).toBeNull()
    expect(lastForwarded?.headers.get('authorization')).toBeNull()
    expect(lastForwarded?.headers.get('accept')).toBe('application/json')
    expect(loader.get.mock.calls[0][0]).toBe(`${SITE}:com.ok:${await computeSha256(SERVER_CODE)}`)
  })

  it('forwards the body for non-GET methods', async () => {
    await (extHandler as Handler)(extEv('com.ok', { method: 'POST', rawBody: '{"a":1}' }))
    expect(lastForwarded?.method).toBe('POST')
    expect(await lastForwarded?.text()).toBe('{"a":1}')
  })

  it('confines the plugin\'s response headers', async () => {
    pluginResponse = () => new Response('<script>x</script>', {
      headers: { 'set-cookie': 'pwn=1', 'content-type': 'text/html', 'clear-site-data': '"*"' },
    })
    const res = await (extHandler as Handler)(extEv('com.ok')) as Response
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('clear-site-data')).toBeNull()
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('refuses inactive, unknown, and other-site plugins', async () => {
    await expect((extHandler as Handler)(extEv('com.inactive'))).rejects.toMatchObject({ statusCode: 403 })
    await expect((extHandler as Handler)(extEv('com.missing'))).rejects.toMatchObject({ statusCode: 404 })
    await expect((extHandler as Handler)(extEv('com.foreign'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('fails closed without a recorded checksum or when KV content was tampered with', async () => {
    await expect((extHandler as Handler)(extEv('com.nochecksum'))).rejects.toMatchObject({ statusCode: 500 })
    await expect((extHandler as Handler)(extEv('com.tampered'))).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('integrity') })
  })

  it('503s when the LOADER binding is unavailable', async () => {
    // getCfBindings() memoises bindings it has seen, so drop them from the module state
    // by passing an env whose LOADER is explicitly absent and resetting the module.
    vi.resetModules()
    const fresh = await import('../../server/routes/_nuxflow/ext/[pluginId]/[...path]')
    const e = extEv('com.ok', { bindings: false })
    await expect((fresh.default as Handler)(e)).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('/_nuxflow/plugin-bundle/:id', () => {
  it('serves a verified client bundle as cross-origin-loadable JavaScript', async () => {
    const e = ev({ params: { id: 'com.ok' } })
    expect(await (bundleHandler as Handler)(e)).toBe(CLIENT_CODE)
    const headers = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    expect(headers['content-type']).toContain('application/javascript')
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('resolves the site from the Host header, not a spoofable context value', async () => {
    const e = ev({ params: { id: 'com.foreign' }, headers: { host: 'plugins.localhost' } })
    await expect((bundleHandler as Handler)(e)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s for inactive plugins and refuses unverified or tampered bundles', async () => {
    await expect((bundleHandler as Handler)(ev({ params: { id: 'com.inactive' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((bundleHandler as Handler)(ev({ params: { id: 'com.nochecksum' } }))).rejects.toMatchObject({ statusCode: 500 })
    await expect((bundleHandler as Handler)(ev({ params: { id: 'com.tampered' } }))).rejects.toMatchObject({ statusCode: 500 })
  })
})

describe('/_nuxflow/plugin-frame/:pluginId/*', () => {
  it('serves the sandboxed frame document for a declared block', async () => {
    const e = ev({ params: { pluginId: 'com.ok', blockName: 'card' } })
    const html = await (frameHandler as Handler)(e) as string
    const headers = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders

    const csp = headers['content-security-policy']
    expect(csp).toMatch(/^sandbox allow-scripts;/)
    expect(csp).not.toContain('allow-same-origin')
    expect(csp).not.toContain('unsafe-inline\'; connect') // scripts: no unsafe-inline
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/)
    expect(headers['cache-control']).toBe('no-store')
    expect(html).toContain('const blockId = "com.ok/card"')
    expect(html).toContain('"/_nuxflow/plugin-bundle/com.ok"')
    expect(html).toContain('event.source !== window.parent')
  })

  it('allows exactly its own inline bootstrap script by hash (script-src \'self\' alone blocks it)', async () => {
    const e = ev({ params: { pluginId: 'com.ok', blockName: 'card' } })
    const html = await (frameHandler as Handler)(e) as string
    const csp = (e as unknown as { _responseHeaders: Record<string, string> })._responseHeaders['content-security-policy']

    const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1])
    expect(scripts).toHaveLength(1)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scripts[0])))
    const expected = btoa(String.fromCharCode(...digest))
    expect(csp).toContain(`'sha256-${expected}'`)
  })

  it('404s for an undeclared block, an inactive plugin, or another site\'s plugin', async () => {
    await expect((frameHandler as Handler)(ev({ params: { pluginId: 'com.ok', blockName: 'nope' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((frameHandler as Handler)(ev({ params: { pluginId: 'com.inactive', blockName: 'card' } }))).rejects.toMatchObject({ statusCode: 404 })
    await expect((frameHandler as Handler)(ev({ params: { pluginId: 'com.foreign', blockName: 'card' } }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('JSON-encodes the block id so it cannot break out of the inline script', async () => {
    const db = getCurrentTestDb()
    const evil = 'x";alert(1);//</script><script>alert(2)</script>'
    await db.insert(dynamicPlugins).values({
      id: 'com.evil', siteId: SITE, name: 'E', version: '1', isActive: true, hasClient: true,
      clientChecksum: 'x', blockDefinitions: [{ id: `com.evil/${evil}` }],
    })
    const html = await (frameHandler as Handler)(ev({ params: { pluginId: 'com.evil', blockName: evil } })) as string
    // Exactly one closing tag — the real one — and the id still decodes to the original.
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    const literal = html.match(/const blockId = (".*")/)![1]
    expect(JSON.parse(literal)).toBe(`com.evil/${evil}`)
  })
})
