/**
 * Sites in member pools (Phase 5a — utils/pool-sites.ts, site-admin.ts): Super Admin →
 * Sites creating, listing, editing and deleting a site that lives in a pool, and hosting
 * plans copied to pools. Both sides: the pool's (pool mode, its own functions) and the
 * control plane's routes against a fake pool binding that keeps its sites in memory.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { contentTypes, hostingPlans, siteDirectory, siteInvitations, sites, userSiteRoles, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSetting, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))
const mockSendEmail = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/email-template', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, sendTemplatedEmail: (...args: unknown[]) => mockSendEmail(...args) }
})
const mockRequestPasswordReset = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/better-auth', () => ({
  getOrCreateBetterAuth: async () => ({
    $context: Promise.resolve({
      internalAdapter: {
        createUser: async (data: { name: string; email: string; emailVerified: boolean }) => {
          const id = ulid()
          await getCurrentTestDb().insert(users).values({ id, ...data })
          return { id, ...data }
        },
      },
    }),
    api: { requestPasswordReset: mockRequestPasswordReset },
  }),
  clearBetterAuthCache: vi.fn(),
}))

const ACCOUNTS = 'https://accounts.platform.test'
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { poolCreateSite, poolDeleteSite, poolSetPlans, poolUpdateSite } = await import('../../server/utils/pool-sites')
const { default: sitesGet } = await import('../../server/api/v1/admin/sites/index.get')
const { default: sitesPost } = await import('../../server/api/v1/admin/sites/index.post')
const { default: sitesPatch } = await import('../../server/api/v1/admin/sites/[id].patch')
const { default: sitesDelete } = await import('../../server/api/v1/admin/sites/[id].delete')
const { default: plansPost } = await import('../../server/api/v1/admin/plans/index.post')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }
type Config = Record<string, unknown> & { public: Record<string, unknown> }
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

function setMode(poolId: string | null) {
  g.useRuntimeConfig = () => {
    const base = baseConfig()
    return { ...base, poolId: poolId ?? '', public: { ...base.public, accountsUrl: ACCOUNTS } }
  }
}

const PRIMARY = 'site-ps-primary'
let operatorId: string

beforeAll(async () => {
  setMode(null)
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, setupCompleted: true })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  operatorId = await seedUser(db, { email: 'op@platform.test', name: 'Op' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
})
afterAll(async () => {
  g.useRuntimeConfig = baseConfig
  await teardownTestDb()
})
beforeEach(() => {
  mockSendEmail.mockClear()
  mockRequestPasswordReset.mockClear()
})
afterEach(() => setMode(null))

const person = (email: string, emailVerified = true) => ({ id: `u-${ulid()}`, name: 'Owner', email, emailVerified, image: null })
const newSite = (domain: string) => ({ id: `site-${ulid()}`, name: 'Client', domain, locale: 'en', timezone: 'UTC', template: 'landing' as const })
/** As the pool's private entrypoint builds it: no current site (createMockEvent would fill in a placeholder). */
function poolEvent(): H3Event {
  const event = createMockEvent() as MockEvent
  event.context.siteId = null
  return event as unknown as H3Event
}

// ── The pool's side ──────────────────────────────────────────────────────────────────

describe('pool: creating a site for its control plane', () => {
  it('creates a ready-to-use site with the owner as its admin, and is safe to repeat', async () => {
    setMode('clientx')
    const site = newSite('made-in-pool.example')
    const owner = person('owner1@client.test')
    const input = { protocol: POOL_PROTOCOL, site, owner, ownerStatus: 'new' as const, actorUserId: 'unknown-operator' }
    expect(await poolCreateSite(poolEvent(), input)).toEqual({ created: true, pending: false })

    const db = getCurrentTestDb()
    const [row] = await db.select().from(sites).where(eq(sites.id, site.id))
    expect(row).toMatchObject({ domain: 'made-in-pool.example', status: 'active', setupCompleted: true })
    expect((await db.select().from(contentTypes).where(eq(contentTypes.siteId, site.id))).map(t => t.slug).sort()).toEqual(['event', 'page', 'post'])
    expect((await db.select().from(userSiteRoles).where(and(eq(userSiteRoles.userId, owner.id), eq(userSiteRoles.siteId, site.id))))[0]?.role).toBe('admin')

    expect(await poolCreateSite(poolEvent(), input)).toEqual({ created: false, pending: false })
    expect(await db.select().from(contentTypes).where(eq(contentTypes.siteId, site.id))).toHaveLength(3)
  })

  it('holds an invitation, not a role, for an owner nobody has proven owns the address', async () => {
    setMode('clientx')
    const site = newSite('unproven-owner.example')
    const owner = person('unproven@client.test', false)
    expect(await poolCreateSite(poolEvent(), { protocol: POOL_PROTOCOL, site, owner, ownerStatus: 'unclaimed', actorUserId: null }))
      .toEqual({ created: true, pending: true })
    const db = getCurrentTestDb()
    expect(await db.select().from(userSiteRoles).where(eq(userSiteRoles.userId, owner.id))).toEqual([])
    expect((await db.select().from(siteInvitations).where(eq(siteInvitations.userId, owner.id)))[0]?.role).toBe('admin')
  })

  it('refuses an address another site uses', async () => {
    setMode('clientx')
    await expect(poolCreateSite(poolEvent(), { protocol: POOL_PROTOCOL, site: newSite('platform.test'), owner: person('x@client.test'), ownerStatus: 'new', actorUserId: null }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('is refused on a control plane', async () => {
    await expect(poolCreateSite(poolEvent(), { protocol: POOL_PROTOCOL, site: newSite('nope.example'), owner: person('y@client.test'), ownerStatus: 'new', actorUserId: null }))
      .rejects.toThrow(/Only a member pool/)
  })
})

describe('pool: editing, deleting, and its copy of the plans', () => {
  it('takes the plans, gives a site one, drops a plan that\'s gone from its sites, then deletes the site', async () => {
    setMode('clientx')
    const db = getCurrentTestDb()
    const site = newSite('planned.example')
    await poolCreateSite(poolEvent(), { protocol: POOL_PROTOCOL, site, owner: person('owner2@client.test'), ownerStatus: 'new', actorUserId: null })

    // A plan the pool doesn't have can't be given to a site.
    await expect(poolUpdateSite(poolEvent(), { protocol: POOL_PROTOCOL, siteId: site.id, changes: { hostingPlanId: 'plan-pro' }, actorUserId: null }))
      .rejects.toMatchObject({ statusCode: 422 })

    const plan = { id: 'plan-pro', name: 'Pro', sortOrder: 0 } as typeof hostingPlans.$inferInsert
    await db.insert(hostingPlans).values(plan) // only to read back a complete row, as the control plane sends
    const [fullPlan] = await db.select().from(hostingPlans).where(eq(hostingPlans.id, 'plan-pro'))
    await db.delete(hostingPlans).where(eq(hostingPlans.id, 'plan-pro'))
    expect(await poolSetPlans(poolEvent(), { protocol: POOL_PROTOCOL, plans: [fullPlan!] })).toEqual({ stored: 1 })

    expect(await poolUpdateSite(poolEvent(), { protocol: POOL_PROTOCOL, siteId: site.id, changes: { hostingPlanId: 'plan-pro', status: 'maintenance' }, actorUserId: null }))
      .toEqual({ updated: true })
    expect((await db.select().from(sites).where(eq(sites.id, site.id)))[0]).toMatchObject({ hostingPlanId: 'plan-pro', status: 'maintenance' })

    await poolSetPlans(poolEvent(), { protocol: POOL_PROTOCOL, plans: [] })
    expect((await db.select().from(sites).where(eq(sites.id, site.id)))[0]?.hostingPlanId).toBeNull()
    expect(await db.select().from(hostingPlans)).toEqual([])

    expect(await poolDeleteSite(poolEvent(), { protocol: POOL_PROTOCOL, siteId: site.id, actorUserId: null })).toMatchObject({ deleted: true })
    expect(await db.select().from(sites).where(eq(sites.id, site.id))).toEqual([])
    expect(await poolDeleteSite(poolEvent(), { protocol: POOL_PROTOCOL, siteId: site.id, actorUserId: null })).toMatchObject({ deleted: false })
  })
})

// ── The control plane's side ─────────────────────────────────────────────────────────

/** A fake pool binding: keeps its sites in memory and records every call. */
function fakePool(poolId: string) {
  const state = { sites: [] as { id: string; name: string; domain: string; status: string; createdAt: string; hostingPlanId: string | null }[] }
  const calls: Record<string, unknown[]> = { createSite: [], updateSite: [], deleteSite: [], setPlans: [] }
  const stub = {
    status: async () => ({ protocol: POOL_PROTOCOL, poolId, commit: null, release: null, siteCount: state.sites.length, lastMigration: null, settingsReceivedAt: null }),
    listSites: async () => state.sites.map(s => ({ ...s })),
    createSite: async (input: { site: { id: string; name: string; domain: string } }) => {
      calls.createSite!.push(input)
      state.sites.push({ id: input.site.id, name: input.site.name, domain: input.site.domain, status: 'active', createdAt: '2026-10-22', hostingPlanId: null })
      return { created: true, pending: false }
    },
    updateSite: async (input: { siteId: string; changes: { domain?: string; status?: string } }) => {
      calls.updateSite!.push(input)
      const s = state.sites.find(x => x.id === input.siteId)
      if (!s) return { updated: false }
      Object.assign(s, input.changes)
      return { updated: true }
    },
    deleteSite: async (input: { siteId: string }) => {
      calls.deleteSite!.push(input)
      state.sites = state.sites.filter(x => x.id !== input.siteId)
      return { deleted: true, failedMediaDeletes: [] }
    },
    setPlans: async (input: unknown) => { calls.setPlans!.push(input); return { stored: 0 } },
    siteDomains: async () => ({ ok: true, value: [] }),
  }
  return { stub, calls, state }
}

const kv = new Map<string, string>()
const kvBinding = { put: async (k: string, v: string) => { kv.set(k, v) }, delete: async (k: string) => { kv.delete(k) }, get: async (k: string) => kv.get(k) ?? null }

function operator(env: Record<string, unknown>, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const waits: Promise<unknown>[] = []
  const event = createMockEvent({
    siteId: PRIMARY,
    method: opts.method ?? 'GET',
    body: opts.body,
    params: opts.params,
    session: { user: { id: operatorId, name: 'Op', email: 'op@platform.test' } },
  }) as MockEvent
  event.context.cloudflare = { env: { PLUGIN_KV: kvBinding, ...env }, context: { waitUntil: (p: Promise<unknown>) => { waits.push(p) } } }
  return { event: event as unknown as H3Event, waits }
}

describe('Super Admin → Sites with a pool', () => {
  const pool = fakePool('clientx')
  const env = { POOL_CLIENTX: pool.stub }
  let siteId: string

  it('creates a site in the pool: owner account here, plans first, routed, owner emailed', async () => {
    const { event } = operator(env, { method: 'POST', body: { name: 'Client', domain: 'Client.Example', poolId: 'clientx', owner: { name: 'Cleo', email: 'cleo@client.test' } } })
    const res = await (sitesPost as Handler)(event) as { id: string; poolId: string; emailDelivery: unknown }
    siteId = res.id
    expect(res.poolId).toBe('clientx')

    expect(pool.calls.setPlans).toHaveLength(1)
    const sent = pool.calls.createSite![0] as { site: { domain: string }; owner: { email: string }; ownerStatus: string; actorUserId: string }
    expect(sent).toMatchObject({ site: { domain: 'client.example' }, owner: { email: 'cleo@client.test' }, ownerStatus: 'new', actorUserId: operatorId })
    // The account was made here, on the control plane.
    expect(await getCurrentTestDb().select().from(users).where(eq(users.email, 'cleo@client.test'))).toHaveLength(1)
    // Routed, and the new owner asked to set a password, pointing back at the site.
    expect(kv.get('pool-route:client.example')).toBe('clientx')
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({ body: { email: 'cleo@client.test', redirectTo: `/reset-password?site=${siteId}&purpose=invite` } })
  })

  it('tells an existing owner their site is ready instead', async () => {
    const { event } = operator(env, { method: 'POST', body: { name: 'Second', domain: 'second.example', poolId: 'clientx', owner: { name: 'Op', email: 'op@platform.test' } } })
    await (sitesPost as Handler)(event)
    expect((pool.calls.createSite![1] as { ownerStatus: string }).ownerStatus).toBe('existing')
    expect(mockSendEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ to: 'op@platform.test', subject: 'Your site Second is ready' }))
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('refuses an address in use anywhere, before asking the pool', async () => {
    const before = pool.calls.createSite!.length
    for (const domain of ['platform.test', 'client.example']) {
      const { event } = operator(env, { method: 'POST', body: { name: 'Dup', domain, poolId: 'clientx', owner: { name: 'D', email: 'd@x.test' } } })
      await expect((sitesPost as Handler)(event)).rejects.toMatchObject({ statusCode: 409 })
    }
    expect(pool.calls.createSite).toHaveLength(before)
  })

  it('refuses an unknown pool, or a pool site without an owner', async () => {
    await expect((sitesPost as Handler)(operator(env, { method: 'POST', body: { name: 'X', domain: 'x.example', poolId: 'nope', owner: { name: 'X', email: 'x@x.test' } } }).event))
      .rejects.toMatchObject({ statusCode: 422 })
    await expect((sitesPost as Handler)(operator(env, { method: 'POST', body: { name: 'X', domain: 'x.example', poolId: 'clientx' } }).event))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('lists pool sites beside its own, with the pools to create in', async () => {
    const res = await (sitesGet as Handler)(operator(env).event) as { sites: { domain: string; poolId: string | null }[]; pools: string[] }
    expect(res.pools).toEqual(['clientx'])
    expect(res.sites).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'platform.test', poolId: null }),
      expect.objectContaining({ domain: 'client.example', poolId: 'clientx' }),
    ]))
  })

  it('edits a pool site in its pool, re-routing a new address', async () => {
    const { event } = operator(env, { method: 'PATCH', params: { id: siteId }, body: { domain: 'client-new.example', status: 'maintenance' } })
    await (sitesPatch as Handler)(event)
    expect(pool.calls.updateSite!.at(-1)).toMatchObject({ siteId, changes: { domain: 'client-new.example', status: 'maintenance' }, actorUserId: operatorId })
    expect(kv.get('pool-route:client-new.example')).toBe('clientx')
    expect(kv.has('pool-route:client.example')).toBe(false)
  })

  it('refuses giving a pool site an address in use elsewhere', async () => {
    const { event } = operator(env, { method: 'PATCH', params: { id: siteId }, body: { domain: 'platform.test' } })
    await expect((sitesPatch as Handler)(event)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('a control-plane site can\'t take an address a pool site has', async () => {
    const { event } = operator(env, { method: 'PATCH', params: { id: PRIMARY }, body: { domain: 'client-new.example' } })
    await expect((sitesPatch as Handler)(event)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('in a pool') })
  })

  it('sends plans on when one changes', async () => {
    const before = pool.calls.setPlans!.length
    const { event, waits } = operator(env, { method: 'POST', body: { name: 'Starter', sortOrder: 0 } })
    await (plansPost as Handler)(event).catch(() => {}) // Stripe sync may refuse in tests; the push is what's checked
    await Promise.all(waits)
    expect(pool.calls.setPlans!.length).toBeGreaterThan(before)
  })

  it('deletes a pool site in its pool, and stops routing to it', async () => {
    const { event } = operator(env, { method: 'DELETE', params: { id: siteId } })
    await (sitesDelete as Handler)(event)
    expect(pool.calls.deleteSite!.at(-1)).toMatchObject({ siteId, actorUserId: operatorId })
    expect(kv.has('pool-route:client-new.example')).toBe(false)
    expect(await getCurrentTestDb().select().from(siteDirectory).where(eq(siteDirectory.poolSiteId, siteId))).toEqual([])
  })
})
