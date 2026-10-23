/**
 * Site deletion with hosting and member pools (server/utils/site-deletion.ts and the two
 * delete routes):
 *  - Deleting a control-plane site keeps the accounts of its users who still belong to a
 *    site elsewhere — another local site (role or pending invitation), a hosting
 *    subscription for another site, or a role/invitation in a member pool. A pool that
 *    can't answer keeps everyone.
 *  - Settings → Danger Zone is refused in a member pool: the site's hosting subscription,
 *    domains and routing live on the control plane, so it must go from Super Admin → Sites.
 *  - Neither route deletes a site with an unfinished move.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { hostingSubscriptions, siteInvitations, siteMoves, sites, users } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedRole, seedSite, seedUser } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { deleteSiteCompletely, poolUsersInUse } = await import('../../server/utils/site-deletion')
const { default: deleteSettingsHandler } = await import('../../server/api/v1/settings/index.delete')
const { default: deleteSiteHandler } = await import('../../server/api/v1/admin/sites/[id].delete')

type Handler = (e: H3Event) => Promise<unknown>
type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }
type Config = Record<string, unknown>
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

function setMode(poolId: string | null) {
  g.useRuntimeConfig = () => ({ ...baseConfig(), poolId: poolId ?? '' })
}

function mkEvent(siteId: string, userId: string, env: Record<string, unknown> = {}, params?: Record<string, string>): H3Event {
  const event = createMockEvent({
    siteId,
    params,
    session: { user: { id: userId, name: 'Operator', email: `${userId.toLowerCase()}@example.com` } },
  }) as MockEvent
  event.context.cloudflare = { env, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

async function userExists(id: string) {
  return !!(await getCurrentTestDb().query.users.findFirst({ where: eq(users.id, id) }))
}

const PRIMARY = 'site-delpool-primary'
let operatorId: string

beforeAll(async () => {
  setMode(null)
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true, setupCompleted: true })
  operatorId = await seedUser(db, { email: 'operator@platform.test' })
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
})
afterAll(async () => {
  g.useRuntimeConfig = baseConfig
  await teardownTestDb()
})
afterEach(() => setMode(null))

describe('deleteSiteCompletely — which accounts are kept', () => {
  it('keeps accounts still used elsewhere (other site, invitation, hosting, a pool) and deletes the rest', async () => {
    const db = getCurrentTestDb()
    const doomed = await seedSite(db, { id: 'site-delpool-a', domain: 'a.platform.test' })
    const other = await seedSite(db, { id: 'site-delpool-b', domain: 'b.platform.test' })
    const onlyHere = await seedUser(db, { email: 'only-here@example.com' })
    const otherRole = await seedUser(db, { email: 'other-role@example.com' })
    const invited = await seedUser(db, { email: 'invited@example.com' })
    const customer = await seedUser(db, { email: 'customer@example.com' })
    const inPool = await seedUser(db, { email: 'in-pool@example.com' })
    for (const u of [onlyHere, otherRole, invited, customer, inPool]) await seedRole(db, u, doomed, 'admin')
    await seedRole(db, otherRole, other, 'editor')
    await db.insert(siteInvitations).values({ id: ulid(), siteId: other, userId: invited, role: 'editor', expiresAt: '2099-01-01T00:00:00Z' })
    await db.insert(hostingSubscriptions).values({
      id: ulid(), ownerUserId: customer, planId: 'plan-x', interval: 'month', status: 'active',
      requestedSubdomain: 'cust', requestedSiteName: 'Cust', hostedSiteId: 'site-in-a-pool',
    })

    const asked: string[][] = []
    const pool = {
      usersInUse: vi.fn(async ({ userIds }: { userIds: string[] }) => {
        asked.push(userIds)
        return { inUse: userIds.filter(id => id === inPool) }
      }),
    }
    await deleteSiteCompletely(mkEvent(PRIMARY, operatorId, { POOL_CLIENTX: pool }), doomed, operatorId)

    // Only the users nothing local holds on to are asked about.
    expect(asked).toHaveLength(1)
    expect(asked[0]!.sort()).toEqual([onlyHere, inPool].sort())
    expect(await userExists(onlyHere)).toBe(false)
    for (const u of [otherRole, invited, customer, inPool]) expect(await userExists(u)).toBe(true)
  })

  it('keeps every account when a pool can\'t answer', async () => {
    const db = getCurrentTestDb()
    const doomed = await seedSite(db, { id: 'site-delpool-c', domain: 'c.platform.test' })
    const userId = await seedUser(db, { email: 'unsure@example.com' })
    await seedRole(db, userId, doomed, 'admin')
    const broken = { usersInUse: vi.fn().mockRejectedValue(new Error('no such method')) }

    await deleteSiteCompletely(mkEvent(PRIMARY, operatorId, { POOL_OLD: broken }), doomed, operatorId)

    expect(await userExists(userId)).toBe(true)
    expect(await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, doomed) })).toBeUndefined()
  })

  it('a pool reports users with a role or invitation on any of its sites', async () => {
    const db = getCurrentTestDb()
    const site = await seedSite(db, { id: 'site-delpool-d', domain: 'd.platform.test' })
    const member = await seedUser(db, { email: 'member-d@example.com' })
    const pending = await seedUser(db, { email: 'pending-d@example.com' })
    const stranger = await seedUser(db, { email: 'stranger-d@example.com' })
    await seedRole(db, member, site, 'member')
    await db.insert(siteInvitations).values({ id: ulid(), siteId: site, userId: pending, role: 'editor', expiresAt: '2099-01-01T00:00:00Z' })

    const { inUse } = await poolUsersInUse(mkEvent(site, operatorId), { protocol: POOL_PROTOCOL, userIds: [member, pending, stranger] })
    expect(inUse.sort()).toEqual([member, pending].sort())
  })
})

describe('DELETE /api/v1/settings in a member pool', () => {
  it('is refused, and the site is untouched', async () => {
    const db = getCurrentTestDb()
    const site = await seedSite(db, { id: 'site-delpool-e', domain: 'e.client.test' })
    await seedRole(db, operatorId, site, 'super_admin')
    setMode('clientx')

    await expect((deleteSettingsHandler as Handler)(mkEvent(site, operatorId))).rejects.toMatchObject({ statusCode: 403 })
    expect(await db.query.sites.findFirst({ where: eq(sites.id, site) })).toBeDefined()
  })
})

describe('deleting a site with an unfinished move', () => {
  async function seedMove(siteId: string, phase: string) {
    await getCurrentTestDb().insert(siteMoves).values({
      id: ulid(), movedSiteId: siteId, siteName: 'Moving', siteDomain: `${siteId}.test`, fromPool: null, toPool: 'clientx', phase,
    })
  }

  it('Super Admin → Sites refuses while a move is under way or failed, and deletes once it is done', async () => {
    const db = getCurrentTestDb()
    const site = await seedSite(db, { id: 'site-delpool-f', domain: 'f.platform.test' })
    await seedMove(site, 'copying')
    await expect((deleteSiteHandler as Handler)(mkEvent(PRIMARY, operatorId, {}, { id: site }))).rejects.toMatchObject({ statusCode: 409 })

    await db.update(siteMoves).set({ phase: 'failed' }).where(eq(siteMoves.movedSiteId, site))
    await expect((deleteSiteHandler as Handler)(mkEvent(PRIMARY, operatorId, {}, { id: site }))).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.sites.findFirst({ where: eq(sites.id, site) })).toBeDefined()

    await db.update(siteMoves).set({ phase: 'cancelled' }).where(eq(siteMoves.movedSiteId, site))
    await (deleteSiteHandler as Handler)(mkEvent(PRIMARY, operatorId, {}, { id: site }))
    expect(await db.query.sites.findFirst({ where: eq(sites.id, site) })).toBeUndefined()
  })

  it('Settings → Danger Zone refuses too', async () => {
    const db = getCurrentTestDb()
    const site = await seedSite(db, { id: 'site-delpool-g', domain: 'g.platform.test' })
    await seedRole(db, operatorId, site, 'super_admin')
    await seedMove(site, 'cleaning')

    await expect((deleteSettingsHandler as Handler)(mkEvent(site, operatorId))).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.query.sites.findFirst({ where: eq(sites.id, site) })).toBeDefined()
  })
})
