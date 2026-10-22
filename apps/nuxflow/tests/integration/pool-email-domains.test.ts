/**
 * Phase 5c of plan 13: mail for sites in member pools, and customers' own domains on
 * them. Email Routing delivers every message to the control plane, which hands mail for
 * a pool's address to that pool (server/utils/inbound-email.ts); Cloudflare for SaaS is
 * called from the control plane while the pool keeps the site's addresses
 * (server/utils/hosting-domains.ts). Pool bindings and Cloudflare's API are faked; each
 * side's own logic runs against the real test database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { emailMessages, hostingPlans, hostingSubscriptions, mailboxes, siteDirectory, siteDomains, sites, siteSettings } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/system-event', () => ({
  createSystemEvent: (opts: { env: unknown; siteId?: string; host?: string }) => {
    const event = createMockEvent({ siteId: opts.siteId, headers: { host: opts.host ?? 'localhost' } }) as unknown as { context: Record<string, unknown> }
    if (!opts.siteId) event.context.siteId = null
    event.context.cloudflare = { env: opts.env, context: { waitUntil: (p: Promise<unknown>) => { void p } } }
    return event
  },
}))
const { mockEmail } = vi.hoisted(() => ({ mockEmail: vi.fn().mockResolvedValue({}) }))
vi.mock('../../server/utils/email-template', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTemplatedEmail: mockEmail,
}))
vi.mock('../../server/utils/webpush', () => ({
  broadcastPushToSite: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: vi.fn().mockResolvedValue(null),
  callAiOrThrow: <T>(fn: () => Promise<T>) => fn(),
}))
vi.mock('../../server/utils/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../server/utils/accounts-origin', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isCentralAuth: () => true,
  isAccountsHost: (event: { _headers?: Record<string, string> }) => event._headers?.host === 'accounts.platform.test',
  getAccountsHost: () => 'accounts.platform.test',
  accountsUrl: (path: string) => `https://accounts.platform.test${path}`,
}))

// ── A fake Cloudflare for SaaS API ─────────────────────────────────────────────
const cloudflare = {
  hostnames: new Map<string, { id: string, hostname: string, status: string, ssl: { status: string } }>(),
  calls: [] as { method: string, url: string, body?: { hostname?: string } }[],
}
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  cloudflare.calls.push({ method, url, body })
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result, errors: [] }), { status: 200 })
  const id = url.split('/custom_hostnames/')[1]
  if (method === 'POST') {
    const h = { id: `cf_${cloudflare.hostnames.size + 1}`, hostname: body.hostname, status: 'pending', ssl: { status: 'pending_validation' } }
    cloudflare.hostnames.set(h.id, h)
    return ok(h)
  }
  if (method === 'GET') return ok(cloudflare.hostnames.get(id!))
  if (method === 'DELETE') {
    cloudflare.hostnames.delete(id!)
    return ok({ id })
  }
  return new Response('{}', { status: 400 })
}))
const goLive = (hostname: string) => {
  const h = [...cloudflare.hostnames.values()].find(x => x.hostname === hostname)!
  h.status = 'active'
  h.ssl.status = 'active'
}

const PLATFORM = 'in.platform.test'
const realRuntimeConfig = globalThis.useRuntimeConfig
function setMode(poolId: string | null) {
  globalThis.useRuntimeConfig = (() => ({ ...realRuntimeConfig(), poolId: poolId ?? '', inboundEmailDomain: PLATFORM, hostingSitesDomain: 'sites.test' })) as typeof globalThis.useRuntimeConfig
}
setMode(null)

const { handleInboundEmail, poolForRecipient, poolInboundRecipient, poolReceiveEmail } = await import('../../server/utils/inbound-email')
const { ensureInboundHandle } = await import('../../server/utils/inbox')
const { poolSiteDomains, poolPendingDomains, checkPendingCustomDomains } = await import('../../server/utils/hosting-domains')
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { clearHostingPlanCache } = await import('../../server/utils/hosting-plans')
const { clearSiteCache } = await import('../../server/middleware/02.multi-site')
const { default: listDomains } = await import('../../server/api/accounts/hosting/domains/index.get')
const { default: addDomain } = await import('../../server/api/accounts/hosting/domains/index.post')
const { default: checkDomain } = await import('../../server/api/accounts/hosting/domains/check.post')
const { default: makeMain } = await import('../../server/api/accounts/hosting/domains/primary.post')
const { default: removeDomain } = await import('../../server/api/accounts/hosting/domains/index.delete')
const { default: deleteSiteRoute } = await import('../../server/api/v1/admin/sites/[id].delete')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }
interface Panel { available: boolean, allowed: number | null, used: number, domains: { hostname: string, kind: string, main: boolean, live: boolean }[] }

const PRIMARY = 'site-pe-primary'
const POOL_SITE = 'site-pe-in-pool'
const SUB = 'sub-pe-cafe'
let operatorId: string
let ownerId: string

function mime(to: string, subject = 'Hello'): string {
  return [`From: Jane <jane@example.org>`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: <${ulid()}@example.org>`, 'Date: Thu, 22 Oct 2026 10:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Is the café open on Sunday?', ''].join('\r\n')
}

function message(to: string, from = 'jane@example.org') {
  const bytes = new TextEncoder().encode(mime(to))
  return {
    from,
    to,
    rawSize: bytes.byteLength,
    raw: new Response(bytes).body!,
    bytes,
    headers: new Headers({ 'authentication-results': 'mx.cloudflare.net; dkim=pass header.d=example.org; spf=pass; dmarc=pass' }),
    setReject: vi.fn(),
    forward: vi.fn().mockResolvedValue({}),
  }
}

type FakeMessage = ReturnType<typeof message>
const deliver = (msg: FakeMessage, env: Record<string, unknown>) =>
  handleInboundEmail(msg as unknown as ForwardableEmailMessage, env, { waitUntil: () => {} })

/** An event inside the pool: what the pool's admin entrypoint hands its handlers. */
function poolEvent(): H3Event {
  const event = createMockEvent({ siteId: undefined, headers: { host: 'localhost' } }) as MockEvent
  event.context.siteId = null
  event.context.cloudflare = { env: { MEDIA_BUCKET: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, name: 'Platform' })
  operatorId = await seedUser(db, { email: 'op@pe.test' })
  ownerId = await seedUser(db, { email: 'owner@pe.test', name: 'Owner' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  await seedSetting(db, PRIMARY, 'hosting.cf_zone_id', 'a'.repeat(32))
  await seedSetting(db, PRIMARY, 'hosting.cf_api_token', 'test-token')
})

afterAll(async () => {
  globalThis.useRuntimeConfig = realRuntimeConfig
  vi.unstubAllGlobals()
  await teardownTestDb()
})

beforeEach(async () => {
  setMode(null)
  const db = getCurrentTestDb()
  await db.delete(siteDirectory)
  await db.delete(siteDomains)
  await db.delete(hostingSubscriptions)
  await db.delete(emailMessages)
  await db.delete(mailboxes)
  await db.delete(hostingPlans)
  await db.delete(sites).where(eq(sites.id, POOL_SITE))
  cloudflare.hostnames.clear()
  cloudflare.calls = []
  mockEmail.mockClear()
  clearSiteCache()
  clearHostingPlatformCache()
  clearHostingPlanCache()
})

// ── Mail ────────────────────────────────────────────────────────────────────────────

describe('which pool an address belongs to (control plane)', () => {
  it("finds a pool site's own domain (and www.) through the site directory", async () => {
    const db = getCurrentTestDb()
    await db.insert(siteDirectory).values([
      { hostname: 'shop.client.test', poolId: 'clientx', poolSiteId: POOL_SITE },
      { hostname: 'www.cafe.test', poolId: 'eu1', poolSiteId: 'other' },
    ])
    expect(await poolForRecipient(db, 'contact@shop.client.test', PLATFORM)).toBe('clientx')
    expect(await poolForRecipient(db, 'hello@cafe.test', PLATFORM)).toBe('eu1')
    expect(await poolForRecipient(db, 'contact@unknown.test', PLATFORM)).toBeNull()
  })

  it('reads the pool from a handle on the shared inbound domain', async () => {
    const db = getCurrentTestDb()
    expect(await poolForRecipient(db, 'shop.clientx+contact@in.platform.test', PLATFORM)).toBe('clientx')
    expect(await poolForRecipient(db, 'shop.clientx@in.platform.test', PLATFORM)).toBe('clientx')
    // The control plane's own handles have no dot, and a pool id has a fixed shape.
    expect(await poolForRecipient(db, 'shop+contact@in.platform.test', PLATFORM)).toBeNull()
    expect(await poolForRecipient(db, 'shop.Not_A_Pool+contact@in.platform.test', PLATFORM)).toBeNull()
    expect(await poolForRecipient(db, '.clientx@in.platform.test', PLATFORM)).toBeNull()
  })
})

describe('handing mail to a pool (control plane)', () => {
  function fakePool(answer: { forwardTo: string | null } | null, refused: string | null = null) {
    return {
      inboundRecipient: vi.fn().mockResolvedValue(answer),
      receiveEmail: vi.fn().mockResolvedValue({ refused }),
    }
  }

  it('forwards a copy where the pool says, then sends the pool the message itself', async () => {
    await getCurrentTestDb().insert(siteDirectory).values({ hostname: 'shop.client.test', poolId: 'clientx', poolSiteId: POOL_SITE })
    const pool = fakePool({ forwardTo: 'owner@gmail.test' })
    const msg = message('contact@shop.client.test')
    await deliver(msg, { POOL_CLIENTX: pool })

    expect(pool.inboundRecipient).toHaveBeenCalledWith({ protocol: POOL_PROTOCOL, to: 'contact@shop.client.test' })
    expect(msg.forward).toHaveBeenCalledWith('owner@gmail.test')
    const sent = pool.receiveEmail.mock.calls[0]![0]
    expect(sent).toMatchObject({ protocol: POOL_PROTOCOL, from: 'jane@example.org', to: 'contact@shop.client.test' })
    expect(sent.authResults).toContain('dkim=pass')
    expect(new Uint8Array(sent.raw)).toEqual(msg.bytes)
    expect(msg.setReject).not.toHaveBeenCalled()
  })

  it("routes a pool's handle on the shared domain without a directory entry", async () => {
    const pool = fakePool({ forwardTo: null })
    const msg = message('shop.clientx+contact@in.platform.test')
    await deliver(msg, { POOL_CLIENTX: pool })
    expect(pool.receiveEmail).toHaveBeenCalledTimes(1)
    expect(msg.forward).not.toHaveBeenCalled()
  })

  it("rejects what the pool doesn't know or won't keep, and loops", async () => {
    await getCurrentTestDb().insert(siteDirectory).values({ hostname: 'shop.client.test', poolId: 'clientx', poolSiteId: POOL_SITE })
    const unknown = fakePool(null)
    const a = message('nobody@shop.client.test')
    await deliver(a, { POOL_CLIENTX: unknown })
    expect(a.setReject).toHaveBeenCalledWith('Unknown recipient')
    expect(unknown.receiveEmail).not.toHaveBeenCalled()

    const full = fakePool({ forwardTo: null }, 'Mailbox over its monthly limit')
    const b = message('contact@shop.client.test')
    await deliver(b, { POOL_CLIENTX: full })
    expect(b.setReject).toHaveBeenCalledWith('Mailbox over its monthly limit')

    const loop = fakePool({ forwardTo: null })
    const c = message('contact@shop.client.test', 'contact@shop.client.test')
    await deliver(c, { POOL_CLIENTX: loop })
    expect(c.setReject).toHaveBeenCalledWith('Loop detected')
    expect(loop.receiveEmail).not.toHaveBeenCalled()
  })

  it("rejects an address in a pool that isn't connected, and never passes mail on from inside a pool", async () => {
    await getCurrentTestDb().insert(siteDirectory).values({ hostname: 'shop.client.test', poolId: 'clientx', poolSiteId: POOL_SITE })
    const a = message('contact@shop.client.test')
    await deliver(a, {})
    expect(a.setReject).toHaveBeenCalledWith('Unknown recipient')

    setMode('clientx')
    const pool = fakePool({ forwardTo: null })
    const b = message('shop.eu1+contact@in.platform.test')
    await deliver(b, { POOL_EU1: pool })
    expect(pool.inboundRecipient).not.toHaveBeenCalled()
    expect(b.setReject).toHaveBeenCalledWith('Unknown recipient')
  })
})

describe('a pool keeping mail for its sites', () => {
  beforeEach(async () => {
    setMode('clientx')
    const db = getCurrentTestDb()
    await seedSite(db, { id: POOL_SITE, domain: 'shop.client.test', name: 'Client Shop' })
    await db.insert(mailboxes).values({ id: ulid(), siteId: POOL_SITE, kind: 'inbox', localPart: 'contact', name: 'Contact', forwardTo: 'owner@gmail.test' })
  })

  it('says where an address forwards, and keeps the message in the inbox', async () => {
    expect(await poolInboundRecipient(poolEvent(), { protocol: POOL_PROTOCOL, to: 'contact@shop.client.test' })).toEqual({ forwardTo: 'owner@gmail.test' })
    expect(await poolInboundRecipient(poolEvent(), { protocol: POOL_PROTOCOL, to: 'nobody@shop.client.test' })).toBeNull()

    const raw = new TextEncoder().encode(mime('contact@shop.client.test', 'Sunday opening')).buffer
    expect(await poolReceiveEmail(poolEvent(), { protocol: POOL_PROTOCOL, from: 'jane@example.org', to: 'contact@shop.client.test', authResults: null, raw }))
      .toEqual({ refused: null })
    const kept = await getCurrentTestDb().select().from(emailMessages).where(eq(emailMessages.siteId, POOL_SITE))
    expect(kept.map(m => m.subject)).toEqual(['Sunday opening'])
  })

  it('takes mail on its pool-suffixed handle, and refuses unknown or oversized mail', async () => {
    const event = createMockEvent({ siteId: POOL_SITE, headers: { host: 'shop.client.test' } }) as unknown as H3Event
    const handle = await ensureInboundHandle(event, getCurrentTestDb(), POOL_SITE)
    expect(handle).toBe('shop.clientx')

    const raw = new TextEncoder().encode(mime(`${handle}+contact@${PLATFORM}`)).buffer
    expect(await poolReceiveEmail(poolEvent(), { protocol: POOL_PROTOCOL, from: 'jane@example.org', to: `${handle}+contact@${PLATFORM}`, authResults: null, raw }))
      .toEqual({ refused: null })
    expect(await poolReceiveEmail(poolEvent(), { protocol: POOL_PROTOCOL, from: 'jane@example.org', to: 'nobody@nowhere.test', authResults: null, raw }))
      .toEqual({ refused: 'Unknown recipient' })
    expect(await poolReceiveEmail(poolEvent(), { protocol: POOL_PROTOCOL, from: 'jane@example.org', to: 'contact@shop.client.test', authResults: null, raw: new ArrayBuffer(26 * 1024 * 1024) }))
      .toEqual({ refused: 'Message too large' })
    expect(await getCurrentTestDb().select().from(emailMessages)).toHaveLength(1)
  })

  // Each on a site of its own: settings are cached per isolate for 30 s.
  it("replaces a handle without the pool's suffix, which the control plane couldn't route", async () => {
    const db = getCurrentTestDb()
    await seedSite(db, { id: 'site-pe-old', domain: 'old.client.test', name: 'Old' })
    await seedSetting(db, 'site-pe-old', 'email.inbound_handle', 'old')
    const event = createMockEvent({ siteId: 'site-pe-old', headers: { host: 'old.client.test' } }) as unknown as H3Event
    expect(await ensureInboundHandle(event, db, 'site-pe-old')).toBe('old.clientx')
    const [row] = await db.select().from(siteSettings).where(and(eq(siteSettings.siteId, 'site-pe-old'), eq(siteSettings.key, 'email.inbound_handle')))
    expect(row!.value).toBe('old.clientx')
  })

  it('keeps plain handles on the control plane', async () => {
    setMode(null)
    const db = getCurrentTestDb()
    await seedSite(db, { id: 'site-pe-plain', domain: 'plain.client.test', name: 'Plain' })
    const event = createMockEvent({ siteId: 'site-pe-plain', headers: { host: 'plain.client.test' } }) as unknown as H3Event
    expect(await ensureInboundHandle(event, db, 'site-pe-plain')).toBe('plain')
  })
})

// ── Customers' own domains ──────────────────────────────────────────────────────────

describe("a pool's side of a site's domains", () => {
  const op = (siteOp: Parameters<typeof poolSiteDomains>[1]['op']) => poolSiteDomains(poolEvent(), { protocol: POOL_PROTOCOL, siteId: POOL_SITE, op: siteOp })
  const newRow = (hostname: string) => ({ id: ulid(), hostname, cfCustomHostnameId: `cf-${hostname}`, status: 'pending', sslStatus: 'pending_validation', verificationErrors: [] })

  beforeEach(async () => {
    setMode('clientx')
    const db = getCurrentTestDb()
    await db.insert(hostingPlans).values({ id: 'plan-pe', name: 'Business', maxCustomDomains: 1 })
    await seedSite(db, { id: POOL_SITE, domain: 'cafe.sites.test', name: 'The Café', hostingPlanId: 'plan-pe' })
  })

  it('keeps rows, refusing duplicates and going over the plan as values the control plane can show', async () => {
    expect(await op({ op: 'assertCanAdd' })).toEqual({ ok: true, value: undefined })
    const inserted = await op({ op: 'insert', row: newRow('www.cafe.co.uk') })
    expect(inserted).toMatchObject({ ok: true, value: { hostname: 'www.cafe.co.uk', siteId: POOL_SITE, kind: 'custom' } })
    expect(await op({ op: 'insert', row: newRow('www.cafe.co.uk') })).toMatchObject({ ok: false, error: { statusCode: 409 } })
    expect(await op({ op: 'assertCanAdd' })).toMatchObject({ ok: false, error: { statusCode: 403, data: { code: 'plan_limit' } } })
    expect(await op({ op: 'rows' })).toMatchObject({ ok: true, value: [{ hostname: 'www.cafe.co.uk' }] })
  })

  it("makes a live domain the main address, tells the owner only once, and lists what's pending", async () => {
    const { value } = await op({ op: 'insert', row: newRow('www.cafe.co.uk') }) as { value: { id: string } }
    expect(await poolPendingDomains(poolEvent(), { protocol: POOL_PROTOCOL, limit: 10 })).toMatchObject([{ hostname: 'www.cafe.co.uk', siteName: 'The Café' }])
    expect(await op({ op: 'makeMain', hostname: 'www.cafe.co.uk' })).toMatchObject({ ok: false, error: { statusCode: 409 } })

    await op({ op: 'setStatus', id: value.id, status: { status: 'active', sslStatus: 'active', verificationErrors: [] } })
    expect(await op({ op: 'claimLiveNotice', id: value.id })).toEqual({ ok: true, value: true })
    expect(await op({ op: 'claimLiveNotice', id: value.id })).toEqual({ ok: true, value: false })
    expect(await poolPendingDomains(poolEvent(), { protocol: POOL_PROTOCOL, limit: 10 })).toEqual([])

    expect(await op({ op: 'makeMain', hostname: 'www.cafe.co.uk' })).toEqual({ ok: true, value: undefined })
    const [site] = await getCurrentTestDb().select().from(sites).where(eq(sites.id, POOL_SITE))
    expect(site!.domain).toBe('www.cafe.co.uk')
    const rows = await getCurrentTestDb().select().from(siteDomains).where(eq(siteDomains.siteId, POOL_SITE))
    expect(rows.map(r => [r.hostname, r.kind]).sort()).toEqual([['cafe.sites.test', 'platform'], ['www.cafe.co.uk', 'custom']])

    await op({ op: 'remove', hostname: 'cafe.sites.test' })
    expect((await getCurrentTestDb().select().from(siteDomains).where(eq(siteDomains.siteId, POOL_SITE))).map(r => r.hostname)).toEqual(['www.cafe.co.uk'])
  })
})

describe("the customer's domains on a pool site (control plane)", () => {
  /** A pool keeping one site's addresses in memory, answering as poolSiteDomains() does. */
  function fakePool(opts: { refuseAdd?: boolean } = {}) {
    const site = { id: POOL_SITE, name: 'The Café', domain: 'cafe.sites.test', status: 'active', hostingPlanId: 'plan-pe' }
    const rows: Record<string, unknown>[] = []
    const ops: string[] = []
    const stub = {
      status: async () => ({ protocol: POOL_PROTOCOL, poolId: 'clientx', commit: null, release: null, siteCount: 1, lastMigration: null, settingsReceivedAt: null }),
      listSites: async () => [{ ...site, createdAt: '', aliases: rows.map(r => r.hostname as string) }],
      getSite: async ({ siteId }: { siteId: string }) => siteId === site.id ? site : null,
      pendingDomains: async () => rows.filter(r => !r.liveNotifiedAt).map(r => ({ ...r, siteName: site.name })),
      siteDomains: async ({ op }: { op: { op: string; row?: Record<string, unknown>; id?: string; hostname?: string; status?: Record<string, unknown> } }) => {
        ops.push(op.op)
        switch (op.op) {
          case 'rows': return { ok: true, value: rows }
          case 'assertCanAdd': return opts.refuseAdd
            ? { ok: false, error: { statusCode: 403, message: "Your plan doesn't include your own domain.", data: { code: 'plan_limit' } } }
            : { ok: true, value: undefined }
          case 'insert': {
            const row = { ...op.row, siteId: site.id, kind: 'custom', liveNotifiedAt: null, createdAt: '' }
            rows.push(row)
            return { ok: true, value: row }
          }
          case 'setStatus': Object.assign(rows.find(r => r.id === op.id)!, op.status); return { ok: true, value: undefined }
          case 'claimLiveNotice': {
            const row = rows.find(r => r.id === op.id)!
            if (row.liveNotifiedAt) return { ok: true, value: false }
            row.liveNotifiedAt = 'now'
            return { ok: true, value: true }
          }
          case 'makeMain': site.domain = op.hostname!; return { ok: true, value: undefined }
          case 'remove': rows.splice(rows.findIndex(r => r.hostname === op.hostname), 1); return { ok: true, value: undefined }
        }
        throw new Error('unexpected op')
      },
      deleteSite: vi.fn().mockResolvedValue({ deleted: true, failedMediaDeletes: [] }),
    }
    return { stub, rows, ops, site }
  }

  const kv = new Map<string, string>()
  function env(pool: unknown) {
    return {
      POOL_CLIENTX: pool,
      PLUGIN_KV: { put: async (k: string, v: string) => { kv.set(k, v) }, delete: async (k: string) => { kv.delete(k) }, get: async (k: string) => kv.get(k) ?? null },
    }
  }
  function onAccounts(pool: unknown, body: Record<string, unknown> = {}, userId = ownerId): H3Event {
    const event = createMockEvent({
      siteId: undefined,
      headers: { host: 'accounts.platform.test' },
      method: 'POST',
      session: { user: { id: userId, name: 'Someone', email: 'someone@pe.test' } },
      body: { id: SUB, ...body },
      query: { id: SUB },
    }) as MockEvent
    event.context.siteId = null
    event.context.cloudflare = { env: env(pool), context: { waitUntil: () => {} } }
    return event as unknown as H3Event
  }
  const call = (handler: unknown, pool: unknown, body: Record<string, unknown> = {}) => (handler as Handler)(onAccounts(pool, body)) as Promise<Panel>

  beforeEach(async () => {
    kv.clear()
    const db = getCurrentTestDb()
    await db.insert(hostingPlans).values({ id: 'plan-pe', name: 'Business', maxCustomDomains: 2 })
    await db.insert(hostingSubscriptions).values({ id: SUB, ownerUserId: ownerId, planId: 'plan-pe', interval: 'month', status: 'active', requestedSubdomain: 'cafe', requestedSiteName: 'The Café', hostedSiteId: POOL_SITE })
    await db.insert(siteDirectory).values({ hostname: 'cafe.sites.test', poolId: 'clientx', poolSiteId: POOL_SITE })
  })

  it('connects a domain at Cloudflare, keeps it in the pool and routes it there straight away', async () => {
    const pool = fakePool()
    const panel = await call(addDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    expect(cloudflare.calls[0]).toMatchObject({ method: 'POST', body: { hostname: 'www.cafe.co.uk' } })
    expect(pool.rows).toMatchObject([{ hostname: 'www.cafe.co.uk', cfCustomHostnameId: 'cf_1' }])
    expect(panel).toMatchObject({ available: true, allowed: 2, used: 1 })
    expect(panel.domains.map(d => d.hostname)).toEqual(['cafe.sites.test', 'www.cafe.co.uk'])
    expect(kv.get('pool-route:www.cafe.co.uk')).toBe('clientx')
    // Nothing about it is kept in the control plane's own table.
    expect(await getCurrentTestDb().select().from(siteDomains)).toEqual([])
  })

  it("refuses a name another site uses anywhere, and shows the pool's refusal as it is", async () => {
    await getCurrentTestDb().insert(siteDirectory).values({ hostname: 'taken.example', poolId: 'eu1', poolSiteId: 'elsewhere' })
    await expect(call(addDomain, fakePool().stub, { hostname: 'taken.example' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(call(addDomain, fakePool({ refuseAdd: true }).stub, { hostname: 'www.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 403, data: { code: 'plan_limit' } })
    expect(cloudflare.calls).toHaveLength(0)
  })

  it('checks it, tells the owner once, makes it the main address and removes it', async () => {
    const pool = fakePool()
    await call(addDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    goLive('www.cafe.co.uk')
    let panel = await call(checkDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    expect(panel.domains[1]).toMatchObject({ live: true })
    await call(checkDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    expect(mockEmail.mock.calls.filter(c => c[1].to === 'owner@pe.test')).toHaveLength(1)
    expect(mockEmail.mock.calls[0]![1].template.paragraphs[0]).toContain('The Café')

    panel = await call(makeMain, pool.stub, { hostname: 'www.cafe.co.uk' })
    expect(pool.site.domain).toBe('www.cafe.co.uk')
    expect(panel.domains[0]).toMatchObject({ hostname: 'www.cafe.co.uk', main: true })

    await expect(call(removeDomain, pool.stub, { hostname: 'www.cafe.co.uk' })).rejects.toMatchObject({ statusCode: 409 })
    pool.site.domain = 'cafe.sites.test'
    await call(removeDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    expect(cloudflare.calls.at(-1)).toMatchObject({ method: 'DELETE' })
    expect(pool.rows).toEqual([])
    expect(kv.has('pool-route:www.cafe.co.uk')).toBe(false)
  })

  it("is checked hourly along with the control plane's own sites", async () => {
    const pool = fakePool()
    await call(addDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    goLive('www.cafe.co.uk')
    const event = createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' } }) as MockEvent
    event.context.cloudflare = { env: env(pool.stub), context: { waitUntil: () => {} } }
    expect(await checkPendingCustomDomains(event as unknown as H3Event)).toEqual({ checked: 1, live: 1 })
    expect(await checkPendingCustomDomains(event as unknown as H3Event)).toEqual({ checked: 0, live: 0 })
  })

  it("only lets the site's owner see them", async () => {
    const event = onAccounts(fakePool().stub, {}, operatorId)
    await expect((listDomains as Handler)(event as unknown as H3Event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('removes the domains from Cloudflare when Super Admin deletes the site', async () => {
    const pool = fakePool()
    await call(addDomain, pool.stub, { hostname: 'www.cafe.co.uk' })
    await getCurrentTestDb().update(hostingSubscriptions).set({ status: 'canceled' }).where(eq(hostingSubscriptions.id, SUB))
    const event = createMockEvent({ siteId: PRIMARY, headers: { host: 'platform.test' }, method: 'DELETE', params: { id: POOL_SITE }, session: { user: { id: operatorId, name: 'Op', email: 'op@pe.test' } } }) as MockEvent
    event.context.cloudflare = { env: env(pool.stub), context: { waitUntil: () => {} } }
    await (deleteSiteRoute as Handler)(event as unknown as H3Event)
    expect(cloudflare.calls.at(-1)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/custom_hostnames/cf_1') })
    expect(pool.stub.deleteSite).toHaveBeenCalled()
  })
})
