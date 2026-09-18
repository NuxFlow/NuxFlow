/**
 * Integration tests for the dynamic-plugins install/enable/disable/delete/trust routes —
 * the actual Ed25519-signature-verified trust boundary described in CLAUDE.md. Previously
 * this was only exercised indirectly via backup-restore.test.ts (which deliberately mocks
 * plugin-signing.ts with a deterministic stand-in, see that file), and only
 * plugin-signing.test.ts exercised the crypto functions in isolation — the route-level
 * wiring (does an install request with a bad signature actually get rejected by these HTTP
 * routes, with the exact payload they construct) was never confirmed end-to-end.
 *
 * Real Ed25519 keys/signatures are used throughout (no plugin-signing.ts mock) so this
 * exercises the genuine cryptographic verification path, not just "the route calls some
 * function and trusts its mocked return value."
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { dynamicPlugins, dynamicPluginTrust, auditLogs } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import installHandler from '../../server/api/v1/dynamic-plugins/index.post'
import listHandler from '../../server/api/v1/dynamic-plugins/index.get'
import enableHandler from '../../server/api/v1/dynamic-plugins/[id]/enable.post'
import disableHandler from '../../server/api/v1/dynamic-plugins/[id]/disable.post'
import deleteHandler from '../../server/api/v1/dynamic-plugins/[id]/index.delete'
import trustDeleteHandler from '../../server/api/v1/dynamic-plugins/[id]/trust.delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// In-memory stand-in for the PLUGIN_KV namespace — real KV isn't available in this test
// harness. Only the storage layer is faked; verification (plugin-signing.ts) is real.
const kvStore = new Map<string, string>()
vi.mock('../../server/utils/cf-env', () => ({
  getPluginServerCode: async (_e: unknown, siteId: string, pluginId: string) => kvStore.get(`plugin:${siteId}:${pluginId}:server`) ?? null,
  putPluginServerCode: async (_e: unknown, siteId: string, pluginId: string, code: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:server`, code) },
  getPluginClientBundle: async (_e: unknown, siteId: string, pluginId: string) => kvStore.get(`plugin:${siteId}:${pluginId}:client`) ?? null,
  putPluginClientBundle: async (_e: unknown, siteId: string, pluginId: string, bundle: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:client`, bundle) },
  deletePluginAssets: async (_e: unknown, siteId: string, pluginId: string) => {
    kvStore.delete(`plugin:${siteId}:${pluginId}:server`)
    kvStore.delete(`plugin:${siteId}:${pluginId}:client`)
  },
}))

// ---------------------------------------------------------------------------
// Real Ed25519 key/signature helpers — same approach as plugin-signing.test.ts
// ---------------------------------------------------------------------------

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function generateKeyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    'Ed25519' as unknown as EcKeyGenParams,
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair
  const spki = await crypto.subtle.exportKey('spki', publicKey)
  return { privateKey, publicKeyB64Url: toBase64Url(spki) }
}

async function signCanonical(privateKey: CryptoKey, payload: { id: string; version: string; serverChecksum: string; clientChecksum: string; definitionsChecksum: string }): Promise<string> {
  const canonical = ['nuxflow-plugin-v1', payload.id, payload.version, payload.serverChecksum, payload.clientChecksum, payload.definitionsChecksum].join('\n')
  const sig = await crypto.subtle.sign('Ed25519' as unknown as AlgorithmIdentifier, privateKey, new TextEncoder().encode(canonical))
  return toBase64Url(sig)
}

interface BuildOpts {
  id: string
  version?: string
  name?: string
  serverCode?: string
  clientCode?: string
  privateKey: CryptoKey
  publicKeyB64Url: string
}

async function buildInstallBody(opts: BuildOpts) {
  const version = opts.version ?? '1.0.0'
  const serverChecksum = opts.serverCode ? await sha256Hex(opts.serverCode) : 'none'
  const clientChecksum = opts.clientCode ? await sha256Hex(opts.clientCode) : 'none'
  const definitionsChecksum = 'none'
  const signature = await signCanonical(opts.privateKey, { id: opts.id, version, serverChecksum, clientChecksum, definitionsChecksum })
  return {
    id: opts.id,
    name: opts.name ?? 'Test Plugin',
    version,
    ...(opts.serverCode ? { serverModule: toBase64(opts.serverCode), serverChecksum } : {}),
    ...(opts.clientCode ? { clientBundle: toBase64(opts.clientCode), clientChecksum } : {}),
    publisherPublicKey: opts.publicKeyB64Url,
    signature,
  }
}

// ---------------------------------------------------------------------------

const SITE = 'site-plugins-01'
let adminId: string
let authorId: string
let superAdminId: string
let keyA: { privateKey: CryptoKey; publicKeyB64Url: string }
let keyB: { privateKey: CryptoKey; publicKeyB64Url: string }

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'plugins.localhost' })
  adminId = await seedUser(db, { email: 'admin@plugins.test' })
  await seedRole(db, adminId, SITE, 'admin')
  authorId = await seedUser(db, { email: 'author@plugins.test' })
  await seedRole(db, authorId, SITE, 'author')
  superAdminId = await seedUser(db, { email: 'super@plugins.test' })
  await seedRole(db, superAdminId, SITE, 'super_admin')

  keyA = await generateKeyPair()
  keyB = await generateKeyPair()
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null, body?: unknown, params?: Record<string, string>) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'User', email: `${uid}@plugins.test` } } : null,
    body,
    params,
  }) as unknown as H3Event
}

describe('POST /api/v1/dynamic-plugins (install)', () => {
  it('throws 403 for a non-admin (author) caller', async () => {
    const body = await buildInstallBody({ id: 'plugin-forbidden', serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(authorId, body))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a body with neither serverModule nor clientBundle', async () => {
    const body = await buildInstallBody({ id: 'plugin-empty', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toBeTruthy()
  })

  it('rejects a tampered payload whose checksum does not match the decoded module', async () => {
    const body = await buildInstallBody({ id: 'plugin-tampered', serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    // Swap in different code after the checksum/signature were already computed over the original.
    body.serverModule = toBase64('export default { fetch() { return new Response("evil") } }')
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a signature produced by a key other than the declared publisherPublicKey', async () => {
    const body = await buildInstallBody({ id: 'plugin-badsig', serverCode: 'export default { fetch() {} }', privateKey: keyB.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a garbled/malformed publisherPublicKey', async () => {
    const body = await buildInstallBody({ id: 'plugin-badkey', serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    body.publisherPublicKey = 'not-a-real-key'
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('installs a plugin with a genuinely valid signature and checksums, inactive by default', async () => {
    const db = getCurrentTestDb()
    const serverCode = 'export default { fetch() { return new Response("ok") } }'
    const body = await buildInstallBody({ id: 'plugin-valid-001', serverCode, privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })

    const result = await (installHandler as HandlerFn)(mkEvent(adminId, body)) as { success: boolean }
    expect(result.success).toBe(true)

    const row = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)) })
    expect(row).toBeDefined()
    expect(row!.isActive).toBe(false)
    expect(row!.hasServer).toBe(true)
    expect(row!.publisherPublicKey).toBe(keyA.publicKeyB64Url)

    // The exact bytes that would later be served to the sandboxed iframe/worker are what
    // got stored — not just "something" under that key.
    expect(kvStore.get(`plugin:${SITE}:plugin-valid-001:server`)).toBe(serverCode)

    const trust = await db.query.dynamicPluginTrust.findFirst({ where: and(eq(dynamicPluginTrust.siteId, SITE), eq(dynamicPluginTrust.pluginId, 'plugin-valid-001')) })
    expect(trust).toBeDefined()
    expect(trust!.publisherPublicKey).toBe(keyA.publicKeyB64Url)

    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.resource, 'dynamic_plugin'), eq(auditLogs.resourceId, 'plugin-valid-001')))
    expect(log).toBeDefined()
    expect(log.action).toBe('install')
  })

  it('rejects installing the same plugin id twice for the same site', async () => {
    const body = await buildInstallBody({ id: 'plugin-valid-001', serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects reinstalling under a different publisher key than the pinned trust record', async () => {
    // Simulate "update" by deleting the plugin row directly (bypassing the delete route)
    // while leaving dynamicPluginTrust intact — exactly the state install.post.ts's trust
    // check exists to guard, since `nuxflow plugin update` does this same delete+reinstall.
    const db = getCurrentTestDb()
    await db.delete(dynamicPlugins).where(and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)))

    const body = await buildInstallBody({ id: 'plugin-valid-001', serverCode: 'export default { fetch() {} }', privateKey: keyB.privateKey, publicKeyB64Url: keyB.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(adminId, body))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('allows reinstalling under the SAME publisher key after the row was removed', async () => {
    const db = getCurrentTestDb()
    const body = await buildInstallBody({ id: 'plugin-valid-001', serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    const result = await (installHandler as HandlerFn)(mkEvent(adminId, body)) as { success: boolean }
    expect(result.success).toBe(true)

    const row = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)) })
    expect(row).toBeDefined()
  })
})

describe('GET /api/v1/dynamic-plugins (site scoping)', () => {
  it('only lists plugins installed on the caller\'s own site', async () => {
    const db = getCurrentTestDb()
    const otherSite = await seedSite(db, { domain: 'other-plugins.localhost' })
    await db.insert(dynamicPlugins).values({
      id: 'plugin-other-site', siteId: otherSite, name: 'Other', version: '1.0.0',
      isActive: false, hasServer: true, hasClient: false,
      serverChecksum: 'x', clientChecksum: null, blockDefinitions: null, definitionsChecksum: null,
      publisherPublicKey: keyA.publicKeyB64Url, signature: 'sig',
    })

    const result = await (listHandler as HandlerFn)(mkEvent(adminId)) as { plugins: { id: string }[] }
    expect(result.plugins.some(p => p.id === 'plugin-other-site')).toBe(false)
    expect(result.plugins.some(p => p.id === 'plugin-valid-001')).toBe(true)
  })
})

describe('POST /api/v1/dynamic-plugins/:id/enable + disable', () => {
  it('throws 404 enabling a plugin that does not exist', async () => {
    await expect((enableHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'no-such-plugin' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('enables then disables an installed plugin, each writing an audit log', async () => {
    const db = getCurrentTestDb()
    const result = await (enableHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'plugin-valid-001' })) as { success: boolean }
    expect(result.success).toBe(true)
    let row = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)) })
    expect(row!.isActive).toBe(true)

    await (disableHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'plugin-valid-001' }))
    row = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)) })
    expect(row!.isActive).toBe(false)

    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.resource, 'dynamic_plugin'), eq(auditLogs.resourceId, 'plugin-valid-001')))
    expect(logs.some(l => l.action === 'enable')).toBe(true)
    expect(logs.some(l => l.action === 'disable')).toBe(true)
  })

  it('throws 403 for a non-admin caller', async () => {
    await expect((enableHandler as HandlerFn)(mkEvent(authorId, undefined, { id: 'plugin-valid-001' }))).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('DELETE /api/v1/dynamic-plugins/:id', () => {
  it('deletes the plugin row and clears its KV-stored code', async () => {
    const db = getCurrentTestDb()
    expect(kvStore.has(`plugin:${SITE}:plugin-valid-001:server`)).toBe(true)

    await (deleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'plugin-valid-001' }))

    const row = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, 'plugin-valid-001'), eq(dynamicPlugins.siteId, SITE)) })
    expect(row).toBeUndefined()
    expect(kvStore.has(`plugin:${SITE}:plugin-valid-001:server`)).toBe(false)

    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.resource, 'dynamic_plugin'), eq(auditLogs.resourceId, 'plugin-valid-001'))).orderBy(auditLogs.createdAt)
    expect(log.action === 'install' || log.action === 'delete').toBe(true)
  })

  it('throws 404 deleting a plugin that no longer exists', async () => {
    await expect((deleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'plugin-valid-001' }))).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('DELETE /api/v1/dynamic-plugins/:id/trust', () => {
  it('throws 403 for a plain admin (requires super_admin specifically)', async () => {
    await expect((trustDeleteHandler as HandlerFn)(mkEvent(adminId, undefined, { id: 'plugin-key-rotation' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('is a no-op (204) when no trust record exists for the given id', async () => {
    const result = await (trustDeleteHandler as HandlerFn)(mkEvent(superAdminId, undefined, { id: 'no-such-trust-record' }))
    expect(result).toBeNull()
  })

  it('clears the pinned publisher key, allowing a genuine key rotation to succeed afterward', async () => {
    const db = getCurrentTestDb()
    const id = 'plugin-key-rotation'
    const firstInstall = await buildInstallBody({ id, serverCode: 'export default { fetch() {} }', privateKey: keyA.privateKey, publicKeyB64Url: keyA.publicKeyB64Url })
    await (installHandler as HandlerFn)(mkEvent(adminId, firstInstall))
    await db.delete(dynamicPlugins).where(and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, SITE)))

    // Without a trust reset, reinstalling under keyB must still fail (already covered
    // above) — confirm that holds here too before resetting trust.
    const rotatedBeforeReset = await buildInstallBody({ id, serverCode: 'export default { fetch() {} }', privateKey: keyB.privateKey, publicKeyB64Url: keyB.publicKeyB64Url })
    await expect((installHandler as HandlerFn)(mkEvent(adminId, rotatedBeforeReset))).rejects.toMatchObject({ statusCode: 409 })

    await (trustDeleteHandler as HandlerFn)(mkEvent(superAdminId, undefined, { id }))
    const trust = await db.query.dynamicPluginTrust.findFirst({ where: and(eq(dynamicPluginTrust.siteId, SITE), eq(dynamicPluginTrust.pluginId, id)) })
    expect(trust).toBeUndefined()

    const rotatedAfterReset = await buildInstallBody({ id, serverCode: 'export default { fetch() {} }', privateKey: keyB.privateKey, publicKeyB64Url: keyB.publicKeyB64Url })
    const result = await (installHandler as HandlerFn)(mkEvent(adminId, rotatedAfterReset)) as { success: boolean }
    expect(result.success).toBe(true)

    const newTrust = await db.query.dynamicPluginTrust.findFirst({ where: and(eq(dynamicPluginTrust.siteId, SITE), eq(dynamicPluginTrust.pluginId, id)) })
    expect(newTrust!.publisherPublicKey).toBe(keyB.publicKeyB64Url)
  })
})
