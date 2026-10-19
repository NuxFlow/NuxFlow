/**
 * Integration tests for dynamic-plugin capabilities: signed permissions and settings,
 * admin approval on enable, in-place updates, the settings form (secret encryption), the
 * host-side capability API (storage, content, drafts, AI, notifications) and event hooks.
 *
 * Signatures are real Ed25519 (as in dynamic-plugins.test.ts). Only the KV storage layer
 * and the plugin runtime's actual Worker Loader call are faked — every permission check,
 * scope and limit runs for real against the test database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, dynamicPlugins, pluginStorage } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import installHandler from '../../server/api/v1/dynamic-plugins/index.post'
import listHandler from '../../server/api/v1/dynamic-plugins/index.get'
import updateHandler from '../../server/api/v1/dynamic-plugins/[id]/index.put'
import enableHandler from '../../server/api/v1/dynamic-plugins/[id]/enable.post'
import deleteHandler from '../../server/api/v1/dynamic-plugins/[id]/index.delete'
import settingsGetHandler from '../../server/api/v1/dynamic-plugins/[id]/settings.get'
import settingsPatchHandler from '../../server/api/v1/dynamic-plugins/[id]/settings.patch'
import * as api from '../../server/utils/plugin-api'
import { contentHookFor, dispatchPluginHook } from '../../server/utils/plugin-hooks'
import { SECRET_MASK } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const kvStore = new Map<string, string>()
vi.mock('../../server/utils/cf-plugin-kv', () => ({
  getPluginServerCode: async (_e: unknown, siteId: string, pluginId: string) => kvStore.get(`plugin:${siteId}:${pluginId}:server`) ?? null,
  putPluginServerCode: async (_e: unknown, siteId: string, pluginId: string, code: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:server`, code) },
  getPluginClientBundle: async () => null,
  putPluginClientBundle: async (_e: unknown, siteId: string, pluginId: string, code: string) => { kvStore.set(`plugin:${siteId}:${pluginId}:client`, code) },
  deletePluginAssets: async () => {},
  spawnPluginWorker: () => { throw new Error('not used') },
  PLUGIN_WORKER_LIMITS: { cpuMs: 50, subRequests: 50 },
}))

// Hooks: record which plugins a delivery reaches instead of spawning a Worker.
const delivered: { pluginId: string, path: string, body: unknown }[] = []
vi.mock('../../server/utils/plugin-runtime', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  invokePlugin: vi.fn(async (_e: unknown, plugin: { id: string }, req: Request) => {
    delivered.push({ pluginId: plugin.id, path: new URL(req.url).pathname, body: await req.json() })
    return new Response(null, { status: 204 })
  }),
}))

// Plugin AI/notify rate limits are exercised by rate-limit's own tests; here they only need to pass.
const rateLimitCalls: string[] = []
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn(async (_e: unknown, opts: { keyPrefix: string }) => { rateLimitCalls.push(opts.keyPrefix) }),
}))

vi.mock('../../server/utils/ai-sdk', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  requireAiSdkModel: vi.fn(async () => ({ fake: true })),
}))
vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  generateText: vi.fn(async ({ prompt }: { prompt: string }) => ({ text: `echo: ${prompt}` })),
}))

// ── Signing helpers ──────────────────────────────────────────────────────────

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const toBase64 = (s: string) => btoa(unescape(encodeURIComponent(s)))
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function generateKeyPair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519' as unknown as EcKeyGenParams, true, ['sign', 'verify']) as CryptoKeyPair
  return { privateKey, publicKeyB64Url: toBase64Url(await crypto.subtle.exportKey('spki', publicKey)) }
}

interface PackageOpts {
  id: string
  version?: string
  permissions?: string[]
  settings?: Record<string, unknown>[]
  serverCode?: string | null
  clientCode?: string
  key: { privateKey: CryptoKey, publicKeyB64Url: string }
  /** Replace the capabilities text after signing (checksum recomputed) — a tampering attempt. */
  tamperCapabilities?: string
}

async function buildPackage(o: PackageOpts) {
  const version = o.version ?? '1.0.0'
  const serverCode = o.serverCode === undefined ? 'export default { fetch() { return new Response("ok") } }' : o.serverCode
  const capabilities = o.permissions || o.settings ? JSON.stringify({ permissions: o.permissions ?? [], settings: o.settings ?? [] }) : null
  const serverChecksum = serverCode ? await sha256Hex(serverCode) : 'none'
  const clientChecksum = o.clientCode ? await sha256Hex(o.clientCode) : 'none'
  const capabilitiesChecksum = capabilities ? await sha256Hex(capabilities) : null
  const lines = [capabilitiesChecksum ? 'nuxflow-plugin-v2' : 'nuxflow-plugin-v1', o.id, version, serverChecksum, clientChecksum, 'none']
  if (capabilitiesChecksum) lines.push(capabilitiesChecksum)
  const sig = await crypto.subtle.sign('Ed25519' as unknown as AlgorithmIdentifier, o.key.privateKey, new TextEncoder().encode(lines.join('\n')))
  const finalCaps = o.tamperCapabilities ?? capabilities
  return {
    id: o.id,
    name: `Plugin ${o.id}`,
    version,
    ...(serverCode ? { serverModule: toBase64(serverCode), serverChecksum } : {}),
    ...(o.clientCode ? { clientBundle: toBase64(o.clientCode), clientChecksum } : {}),
    ...(finalCaps ? { capabilities: finalCaps, capabilitiesChecksum: await sha256Hex(finalCaps) } : {}),
    publisherPublicKey: o.key.publicKeyB64Url,
    signature: toBase64Url(sig),
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SITE = 'site-plugin-caps-01'
const OTHER = 'site-plugin-caps-02'
let adminId: string
let keyA: Awaited<ReturnType<typeof generateKeyPair>>
let keyB: Awaited<ReturnType<typeof generateKeyPair>>
let postTypeId: string
let publicPostId: string

type Handler = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'caps.localhost' })
  await seedSite(db, { id: OTHER, domain: 'caps2.localhost' })
  adminId = await seedUser(db, { email: 'admin@caps.test' })
  await seedRole(db, adminId, SITE, 'admin')
  keyA = await generateKeyPair()
  keyB = await generateKeyPair()

  postTypeId = await seedContentType(db, SITE, { slug: 'post', name: 'Posts', singularName: 'Post' })
  publicPostId = await seedContentItem(db, SITE, postTypeId, { title: 'Hello world', slug: 'hello-world', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Public body' }] }] } })
  await seedContentItem(db, SITE, postTypeId, { title: 'Members only', slug: 'members-only', visibility: 'members' })
  await seedContentItem(db, SITE, postTypeId, { title: 'Secret draft', slug: 'secret-draft', status: 'draft' })
  const otherType = await seedContentType(db, OTHER, { slug: 'post' })
  await seedContentItem(db, OTHER, otherType, { title: 'Other site post', slug: 'other-post' })
})

afterAll(teardownTestDb)
beforeEach(() => { delivered.length = 0 })

function adminEvent(body?: unknown, params?: Record<string, string>, siteId = SITE) {
  return createMockEvent({
    siteId,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@caps.test' } },
    body,
    params,
  }) as unknown as H3Event
}

function apiCtx(pluginId: string, permissions: string[], siteId = SITE): api.PluginCallContext {
  return { event: createMockEvent({ siteId }) as unknown as H3Event, siteId, pluginId, permissions }
}

async function install(o: PackageOpts) {
  return (installHandler as Handler)(adminEvent(await buildPackage(o)))
}

async function row(id: string) {
  return getCurrentTestDb().query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.siteId, SITE), eq(dynamicPlugins.id, id)) })
}

// ── Install ──────────────────────────────────────────────────────────────────

describe('installing a plugin with capabilities', () => {
  it('stores the signed capabilities and grants nothing yet', async () => {
    await install({ id: 'cap.basic', permissions: ['storage', 'content:read'], settings: [{ key: 'greeting', label: 'Greeting', type: 'text', default: 'Hi' }], key: keyA })
    const r = await row('cap.basic')
    expect(r?.isActive).toBe(false)
    expect(r?.grantedPermissions).toBeNull()
    expect(JSON.parse(r!.capabilities!).permissions).toEqual(['storage', 'content:read'])
  })

  it('refuses capabilities changed after signing, even with a recomputed checksum', async () => {
    const tampered = JSON.stringify({ permissions: ['storage', 'network:evil.example.com'], settings: [] })
    await expect(install({ id: 'cap.tampered', permissions: ['storage'], tamperCapabilities: tampered, key: keyA })).rejects.toMatchObject({ statusCode: 400 })
    expect(await row('cap.tampered')).toBeUndefined()
  })

  it('refuses unknown permissions and permissions without a server module', async () => {
    await expect(install({ id: 'cap.unknown', permissions: ['database'], key: keyA })).rejects.toMatchObject({ statusCode: 400 })
    await expect(install({ id: 'cap.clientonly', permissions: ['storage'], serverCode: null, clientCode: 'export function renderBlock() {}', key: keyA })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses ids that would break KV keys or URLs', async () => {
    await expect(install({ id: 'bad:id', key: keyA })).rejects.toMatchObject({ statusCode: 422 })
    await expect(install({ id: 'bad/id', key: keyA })).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── Enable / approval ────────────────────────────────────────────────────────

describe('enabling requires approving the exact permissions', () => {
  it('refuses enabling without approval, or with a different list', async () => {
    await expect((enableHandler as Handler)(adminEvent(undefined, { id: 'cap.basic' }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((enableHandler as Handler)(adminEvent({ approvedPermissions: ['storage'] }, { id: 'cap.basic' }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((enableHandler as Handler)(adminEvent({ approvedPermissions: ['storage', 'content:read', 'ai'] }, { id: 'cap.basic' }))).rejects.toMatchObject({ statusCode: 409 })
    expect((await row('cap.basic'))?.isActive).toBe(false)
  })

  it('records the grant when the approved list matches', async () => {
    await (enableHandler as Handler)(adminEvent({ approvedPermissions: ['content:read', 'storage'] }, { id: 'cap.basic' }))
    const r = await row('cap.basic')
    expect(r?.isActive).toBe(true)
    expect(r?.grantedPermissions).toEqual(['content:read', 'storage'])
  })

  it('lists permissions and approval state, never the stored settings', async () => {
    const { plugins } = await (listHandler as Handler)(adminEvent()) as { plugins: Record<string, unknown>[] }
    const p = plugins.find(x => x.id === 'cap.basic')!
    expect(p.permissions).toEqual(['content:read', 'storage'])
    expect(p.needsApproval).toBe(false)
    expect(p.hasSettings).toBe(true)
    expect(p).not.toHaveProperty('settingsValues')
  })
})

// ── Settings ─────────────────────────────────────────────────────────────────

describe('plugin settings', () => {
  const settings = [
    { key: 'api_key', label: 'API key', type: 'secret', required: true },
    { key: 'mode', label: 'Mode', type: 'select', options: [{ label: 'Fast', value: 'fast' }, { label: 'Slow', value: 'slow' }], default: 'fast' },
    { key: 'enabled', label: 'Enabled', type: 'toggle' },
  ]

  beforeAll(async () => {
    await install({ id: 'cap.settings', permissions: ['storage'], settings, key: keyA })
  })

  it('encrypts secrets at rest and masks them for the admin', async () => {
    await (settingsPatchHandler as Handler)(adminEvent({ values: { api_key: 'sk-live-123', mode: 'slow', enabled: true } }, { id: 'cap.settings' }))
    const stored = (await row('cap.settings'))!.settingsValues!
    expect(stored.api_key).not.toBe('sk-live-123')
    expect(String(stored.api_key)).not.toContain('sk-live')

    const view = await (settingsGetHandler as Handler)(adminEvent(undefined, { id: 'cap.settings' })) as { values: Record<string, unknown> }
    expect(view.values).toEqual({ api_key: SECRET_MASK, mode: 'slow', enabled: true })
  })

  it('keeps a secret sent back as the mask, and hands the plugin the decrypted value', async () => {
    await (settingsPatchHandler as Handler)(adminEvent({ values: { api_key: SECRET_MASK, mode: 'fast', enabled: false } }, { id: 'cap.settings' }))
    expect(await api.getSettings(apiCtx('cap.settings', []))).toEqual({ api_key: 'sk-live-123', mode: 'fast', enabled: false })
  })

  it('validates values against the declared form', async () => {
    await expect((settingsPatchHandler as Handler)(adminEvent({ values: { mode: 'turbo' } }, { id: 'cap.settings' }))).rejects.toMatchObject({ statusCode: 422 })
    await expect((settingsPatchHandler as Handler)(adminEvent({ values: { nope: 1 } }, { id: 'cap.settings' }))).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── Updates ──────────────────────────────────────────────────────────────────

describe('updating a plugin in place', () => {
  beforeAll(async () => {
    await install({ id: 'cap.update', permissions: ['storage'], settings: [{ key: 'name', label: 'Name', type: 'text' }], key: keyA })
    await (enableHandler as Handler)(adminEvent({ approvedPermissions: ['storage'] }, { id: 'cap.update' }))
    await (settingsPatchHandler as Handler)(adminEvent({ values: { name: 'Kept' } }, { id: 'cap.update' }))
    await api.storagePut(apiCtx('cap.update', ['storage']), 'k', { kept: true })
  })

  it('keeps it active, its settings and its data when permissions are unchanged', async () => {
    const res = await (updateHandler as Handler)(adminEvent(await buildPackage({ id: 'cap.update', version: '1.1.0', permissions: ['storage'], settings: [{ key: 'name', label: 'Name', type: 'text' }], key: keyA }), { id: 'cap.update' })) as { needsApproval: boolean }
    expect(res.needsApproval).toBe(false)
    const r = await row('cap.update')
    expect(r).toMatchObject({ version: '1.1.0', isActive: true, settingsValues: { name: 'Kept' } })
    expect(await api.storageGet(apiCtx('cap.update', ['storage']), 'k')).toEqual({ kept: true })
  })

  it('switches the plugin off when an update asks for more', async () => {
    const res = await (updateHandler as Handler)(adminEvent(await buildPackage({ id: 'cap.update', version: '1.2.0', permissions: ['storage', 'network:api.example.com'], key: keyA }), { id: 'cap.update' })) as { needsApproval: boolean }
    expect(res.needsApproval).toBe(true)
    const r = await row('cap.update')
    expect(r?.isActive).toBe(false)
    expect(r?.grantedPermissions).toEqual(['storage'])
    // The new version has no settings form, so the old value goes.
    expect(r?.settingsValues).toBeNull()
  })

  it('refuses another publisher key, a mismatched id, or an unknown plugin', async () => {
    await expect((updateHandler as Handler)(adminEvent(await buildPackage({ id: 'cap.update', version: '9.0.0', key: keyB }), { id: 'cap.update' }))).rejects.toMatchObject({ statusCode: 409 })
    await expect((updateHandler as Handler)(adminEvent(await buildPackage({ id: 'cap.other', key: keyA }), { id: 'cap.update' }))).rejects.toMatchObject({ statusCode: 400 })
    await expect((updateHandler as Handler)(adminEvent(await buildPackage({ id: 'cap.nothere', key: keyA }), { id: 'cap.nothere' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('removes its stored data when uninstalled', async () => {
    await (deleteHandler as Handler)(adminEvent(undefined, { id: 'cap.update' }))
    const left = await getCurrentTestDb().select().from(pluginStorage).where(and(eq(pluginStorage.siteId, SITE), eq(pluginStorage.pluginId, 'cap.update')))
    expect(left).toHaveLength(0)
  })
})

// ── Capability API ───────────────────────────────────────────────────────────

describe('storage capability', () => {
  const ctx = () => apiCtx('cap.store', ['storage'])

  it('needs the storage permission', async () => {
    await expect(api.storageGet(apiCtx('cap.store', []), 'k')).rejects.toThrow(/storage/)
  })

  it('round-trips JSON values and lists keys by prefix with a cursor', async () => {
    await api.storagePut(ctx(), 'user:1', { n: 1 })
    await api.storagePut(ctx(), 'user:2', [1, 2])
    await api.storagePut(ctx(), 'user_3', 'x')
    await api.storagePut(ctx(), 'other', true)
    expect(await api.storageGet(ctx(), 'user:2')).toEqual([1, 2])
    const page1 = await api.storageList(ctx(), { prefix: 'user:', limit: 1 })
    expect(page1.keys.map(k => k.key)).toEqual(['user:1'])
    const page2 = await api.storageList(ctx(), { prefix: 'user:', cursor: page1.cursor })
    expect(page2.keys.map(k => k.key)).toEqual(['user:2'])
    expect(page2.cursor).toBeNull()
    await api.storageDelete(ctx(), 'other')
    expect(await api.storageGet(ctx(), 'other')).toBeNull()
  })

  it('is invisible to other plugins and other sites', async () => {
    await api.storagePut(ctx(), 'mine', 1)
    expect(await api.storageGet(apiCtx('cap.someone-else', ['storage']), 'mine')).toBeNull()
    expect(await api.storageGet(apiCtx('cap.store', ['storage'], OTHER), 'mine')).toBeNull()
  })

  it('hides expired values', async () => {
    await api.storagePut(ctx(), 'temp', 'soon gone', { ttlSeconds: 60 })
    expect(await api.storageGet(ctx(), 'temp')).toBe('soon gone')
    await getCurrentTestDb().update(pluginStorage).set({ expiresAt: '2000-01-01 00:00:00' })
      .where(and(eq(pluginStorage.siteId, SITE), eq(pluginStorage.pluginId, 'cap.store'), eq(pluginStorage.key, 'temp')))
    expect(await api.storageGet(ctx(), 'temp')).toBeNull()
  })

  it('enforces value, key and total-size limits', async () => {
    await expect(api.storagePut(ctx(), 'big', 'x'.repeat(api.STORAGE_LIMITS.maxValueBytes + 1))).rejects.toThrow(/limit/)
    await expect(api.storagePut(ctx(), 'k'.repeat(513), 1)).rejects.toThrow(/key/)
    await expect(api.storagePut(ctx(), '', 1)).rejects.toThrow(/key/)
    await expect(api.storagePut(ctx(), 'undef', undefined)).rejects.toThrow(/undefined/)
    await expect(api.storagePut(ctx(), 'ttl', 1, { ttlSeconds: 5 })).rejects.toThrow(/ttlSeconds/)
  })
})

describe('content capabilities', () => {
  it('reads only published, public content of its own site', async () => {
    const { items } = await api.listContent(apiCtx('cap.content', ['content:read']))
    expect(items.map(i => i.slug)).toEqual(['hello-world'])
    expect(items[0]).toMatchObject({ type: 'post', path: '/hello-world' })

    expect(await api.getContent(apiCtx('cap.content', ['content:read']), { slug: 'secret-draft' })).toBeNull()
    expect(await api.getContent(apiCtx('cap.content', ['content:read']), { slug: 'members-only' })).toBeNull()
    expect(await api.getContent(apiCtx('cap.content', ['content:read']), { slug: 'other-post' })).toBeNull()
    const item = await api.getContent(apiCtx('cap.content', ['content:read']), { id: publicPostId })
    expect(item?.markdown).toContain('Public body')
  })

  it('needs content:read', async () => {
    await expect(api.listContent(apiCtx('cap.content', ['storage']))).rejects.toThrow(/content:read/)
  })

  it('creates drafts only, without remote images', async () => {
    const { id, slug } = await api.createDraft(apiCtx('cap.writer', ['content:write']), {
      title: 'Hello world',
      html: '<p>Imported <img src="https://tracker.example/pixel.gif"></p>',
    })
    expect(slug).toBe('hello-world-2')
    const item = await getCurrentTestDb().query.contentItems.findFirst({ where: and(eq(contentItems.siteId, SITE), eq(contentItems.id, id)) })
    expect(item?.status).toBe('draft')
    expect(item?.authorId).toBeNull()
    expect(JSON.stringify(item?.content)).not.toContain('tracker.example')
    expect(JSON.stringify(item?.content)).toContain('Imported')
    await expect(api.createDraft(apiCtx('cap.writer', ['content:read']), { title: 'x' })).rejects.toThrow(/content:write/)
    await expect(api.createDraft(apiCtx('cap.writer', ['content:write']), { title: 'x', type: 'nope' })).rejects.toThrow(/content type/)
  })
})

describe('AI and notification capabilities', () => {
  it('generates text only with the ai permission', async () => {
    expect(await api.aiGenerateText(apiCtx('cap.ai', ['ai']), { prompt: 'hi' })).toEqual({ text: 'echo: hi' })
    // Rate-limited per plugin, not per visitor IP (there is none — it's a system call).
    expect(rateLimitCalls).toContain('plugin-ai:cap.ai')
    await expect(api.aiGenerateText(apiCtx('cap.ai', []), { prompt: 'hi' })).rejects.toThrow(/"ai"/)
    await expect(api.aiGenerateText(apiCtx('cap.ai', ['ai']), { prompt: '' })).rejects.toThrow(/prompt/)
  })

  it('only links notifications to paths on this site', async () => {
    await expect(api.notifyAdmins(apiCtx('cap.basic', ['notify']), { title: 't', body: 'b', url: 'https://evil.example' })).rejects.toThrow(/path/)
    await expect(api.notifyAdmins(apiCtx('cap.basic', ['notify']), { title: 't', body: 'b', url: '//evil.example' })).rejects.toThrow(/path/)
    await expect(api.notifyAdmins(apiCtx('cap.basic', []), { title: 't', body: 'b' })).rejects.toThrow(/notify/)
    const { sent } = await api.notifyAdmins(apiCtx('cap.basic', ['notify']), { title: 'Sync done', body: '3 items', url: '/admin/plugins' })
    expect(sent).toBe(1)
  })
})

// ── Hooks ────────────────────────────────────────────────────────────────────

describe('event hooks', () => {
  beforeAll(async () => {
    await install({ id: 'cap.hooked', permissions: ['hook:content.published'], key: keyA })
    await (enableHandler as Handler)(adminEvent({ approvedPermissions: ['hook:content.published'] }, { id: 'cap.hooked' }))
    await install({ id: 'cap.hook-inactive', permissions: ['hook:content.published'], key: keyA })
    await install({ id: 'cap.hook-other', permissions: ['hook:form.submitted'], key: keyA })
    await (enableHandler as Handler)(adminEvent({ approvedPermissions: ['hook:form.submitted'] }, { id: 'cap.hook-other' }))
  })

  it('delivers only to active plugins granted that hook, on the reserved path', async () => {
    const sent = await dispatchPluginHook(createMockEvent({ siteId: SITE }) as unknown as H3Event, SITE, 'content.published', { id: 'x' })
    expect(sent).toBe(1)
    expect(delivered).toEqual([{ pluginId: 'cap.hooked', path: '/__nuxflow/hooks/content.published', body: expect.objectContaining({ event: 'content.published', data: { id: 'x' } }) }])
  })

  it('never builds the payload when nobody is listening', async () => {
    const build = vi.fn(async () => ({}))
    expect(await dispatchPluginHook(createMockEvent({ siteId: OTHER }) as unknown as H3Event, OTHER, 'content.published', build)).toBe(0)
    expect(build).not.toHaveBeenCalled()
  })

  it('only reports public content changes', () => {
    const pub = { status: 'published', visibility: 'public' }
    expect(contentHookFor(null, pub)).toBe('content.published')
    expect(contentHookFor({ status: 'draft', visibility: 'public' }, pub)).toBe('content.published')
    expect(contentHookFor(pub, pub)).toBe('content.updated')
    expect(contentHookFor(pub, { status: 'archived', visibility: 'public' })).toBe('content.unpublished')
    expect(contentHookFor(pub, { status: 'published', visibility: 'members' })).toBe('content.unpublished')
    expect(contentHookFor(pub, null)).toBe('content.unpublished')
    expect(contentHookFor(null, { status: 'published', visibility: 'members' })).toBeNull()
    expect(contentHookFor({ status: 'draft', visibility: 'public' }, { status: 'review', visibility: 'public' })).toBeNull()
  })
})

// ── Backup and restore ───────────────────────────────────────────────────────

describe('backup and restore of a plugin with capabilities', () => {
  it('exports non-secret settings and stored data, never secrets', async () => {
    const { buildBackup } = await import('../../server/utils/backup')
    await api.storagePut(apiCtx('cap.settings', ['storage']), 'saved', { n: 1 })
    await api.storagePut(apiCtx('cap.settings', ['storage']), 'expired', 1, { ttlSeconds: 60 })
    await getCurrentTestDb().update(pluginStorage).set({ expiresAt: '2000-01-01 00:00:00' })
      .where(and(eq(pluginStorage.siteId, SITE), eq(pluginStorage.pluginId, 'cap.settings'), eq(pluginStorage.key, 'expired')))

    const backup = await buildBackup(adminEvent(), SITE)
    const settingsPlugin = backup.plugins.find(p => p.pluginId === 'cap.settings')!
    expect(settingsPlugin.capabilities).toContain('api_key')
    expect(settingsPlugin.settings).toEqual({ mode: 'fast', enabled: false })
    expect(settingsPlugin.storage).toEqual([{ key: 'saved', value: '{"n":1}', expiresAt: null }])
  })

  it('restores capabilities, settings and data inactive with nothing granted — and rejects tampered capabilities', async () => {
    const { restoreOnePlugin } = await import('../../server/utils/backup-restore/restore-plugins')
    const serverCode = 'export default { fetch() { return new Response("restored") } }'
    const pkg = await buildPackage({ id: 'cap.restored', permissions: ['storage'], settings: [{ key: 'label', label: 'Label', type: 'text' }], serverCode, key: keyA })
    const entry = {
      pluginId: pkg.id, name: pkg.name, version: pkg.version, description: '', isActive: true, hasServer: true, hasClient: false,
      serverChecksum: pkg.serverChecksum!, clientChecksum: null, blockDefinitions: null, definitionsChecksum: null,
      publisherPublicKey: pkg.publisherPublicKey, signature: pkg.signature, serverCode, clientBundle: null,
      capabilities: pkg.capabilities!, capabilitiesChecksum: pkg.capabilitiesChecksum!,
      settings: { label: 'Restored', unknown_key: 'dropped' },
      storage: [{ key: 'a', value: '{"x":1}', expiresAt: null }, { key: 'bad', value: 'not json', expiresAt: null }],
    }
    const db = getCurrentTestDb()
    const result = { plugins: { created: 0, updated: 0, skipped: 0, rejected: 0 } } as Parameters<typeof restoreOnePlugin>[5]

    // Same entry with an added permission and a recomputed checksum: the signature no longer covers it.
    const tamperedCaps = JSON.stringify({ permissions: ['storage', 'ai'], settings: [] })
    await restoreOnePlugin(adminEvent(), db, SITE, { ...entry, capabilities: tamperedCaps, capabilitiesChecksum: await sha256Hex(tamperedCaps) }, { what: ['plugins'], conflictMode: 'skip' }, result)
    expect(result.plugins.rejected).toBe(1)
    expect(await row('cap.restored')).toBeUndefined()

    await restoreOnePlugin(adminEvent(), db, SITE, entry, { what: ['plugins'], conflictMode: 'skip' }, result)
    expect(result.plugins.created).toBe(1)
    const r = await row('cap.restored')
    expect(r).toMatchObject({ isActive: false, grantedPermissions: null, settingsValues: { label: 'Restored' } })
    expect(await api.storageGet(apiCtx('cap.restored', ['storage']), 'a')).toEqual({ x: 1 })
    expect(await api.storageGet(apiCtx('cap.restored', ['storage']), 'bad')).toBeNull()
  })
})
