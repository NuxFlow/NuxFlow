/**
 * A site paused for non-payment stays in maintenance mode, where /admin and /api stay open,
 * so PATCH /api/v1/settings mustn't let its admin switch it back on (utils/hosting-hold.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { hostingSubscriptions, sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: patchHandler } = await import('../../server/api/v1/settings/index.patch')
const { clearHostingPlatformCache } = await import('../../server/utils/hosting-platform')
const { POOL_PROTOCOL } = await import('../../server/utils/pool-admin')
const { siteBillingHold } = await import('../../server/utils/hosting-hold')

const PRIMARY = 'site-reopen-primary'
const SITE = 'site-reopen-customer'
let adminId: string
let operatorId: string

type Config = ReturnType<typeof useRuntimeConfig>
const g = globalThis as unknown as { useRuntimeConfig: () => Config }
const baseConfig = g.useRuntimeConfig

function setPool(poolId: string | null) {
  g.useRuntimeConfig = () => ({ ...baseConfig(), poolId: poolId ?? '' }) as Config
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true })
  await seedSetting(db, PRIMARY, 'platform.hosting_enabled', 'true')
  await seedSite(db, { id: SITE, domain: 'customer.test' })
  adminId = await seedUser(db, { email: 'admin@reopen.test' })
  operatorId = await seedUser(db, { email: 'operator@reopen.test' })
  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, operatorId, SITE, 'super_admin')
})

afterAll(async () => {
  g.useRuntimeConfig = baseConfig
  await teardownTestDb()
})

beforeEach(async () => {
  setPool(null)
  clearHostingPlatformCache()
  const db = getCurrentTestDb()
  await db.delete(hostingSubscriptions)
  await db.update(sites).set({ status: 'maintenance' }).where(eq(sites.id, SITE))
})

async function seedSubscription(fields: Partial<typeof hostingSubscriptions.$inferInsert>) {
  await getCurrentTestDb().insert(hostingSubscriptions).values({
    id: ulid(),
    ownerUserId: adminId,
    planId: 'plan-1',
    interval: 'month',
    status: 'active',
    requestedSubdomain: 'customer',
    requestedSiteName: 'Customer',
    hostedSiteId: SITE,
    ...fields,
  })
}

function saveStatus(status: string, userId = adminId, env?: Record<string, unknown>) {
  const event = createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'U', email: 'u@reopen.test' } },
    body: { status },
  })
  if (env) event.context.cloudflare = { env, context: { waitUntil: () => {} } }
  return (patchHandler as (e: H3Event) => Promise<unknown>)(event as unknown as H3Event)
}

async function siteStatus() {
  const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, SITE), columns: { status: true } })
  return row?.status
}

describe('taking a site out of maintenance from Settings', () => {
  it('is refused while billing has paused the site', async () => {
    await seedSubscription({ status: 'unpaid', pausedForNonPayment: true })
    await expect(saveStatus('active')).rejects.toMatchObject({ statusCode: 403, data: { code: 'hosting_unpaid' } })
    expect(await siteStatus()).toBe('maintenance')
  })

  // Billing only flags a site that was active, so choosing maintenance just before the
  // subscription ends must not leave a way back in.
  it('is refused when the subscription has ended, even with no pause flag', async () => {
    await seedSubscription({ status: 'canceled', pausedForNonPayment: false })
    await expect(saveStatus('active')).rejects.toMatchObject({ statusCode: 403 })
    expect(await siteStatus()).toBe('maintenance')
  })

  it('is allowed while the subscription is paid up', async () => {
    await seedSubscription({ status: 'active' })
    await saveStatus('active')
    expect(await siteStatus()).toBe('active')
  })

  it('is allowed with a card still being retried, since the site is not paused yet', async () => {
    await seedSubscription({ status: 'past_due' })
    await saveStatus('active')
    expect(await siteStatus()).toBe('active')
  })

  it('is allowed for a site with no hosting subscription (ordinary installs)', async () => {
    await saveStatus('active')
    expect(await siteStatus()).toBe('active')
  })

  it('is allowed for the operator', async () => {
    await seedSubscription({ status: 'unpaid', pausedForNonPayment: true })
    await saveStatus('active', operatorId)
    expect(await siteStatus()).toBe('active')
  })

  it('does not stop a paused site saving Settings with its status unchanged', async () => {
    await seedSubscription({ status: 'unpaid', pausedForNonPayment: true })
    await saveStatus('maintenance')
    expect(await siteStatus()).toBe('maintenance')
  })

  it('leaves the status alone on a site that is already active', async () => {
    await getCurrentTestDb().update(sites).set({ status: 'active' }).where(eq(sites.id, SITE))
    await seedSubscription({ status: 'canceled' })
    await saveStatus('active')
    expect(await siteStatus()).toBe('active')
  })
})

describe('with hosting switched off', () => {
  it('ignores an old subscription row', async () => {
    const db = getCurrentTestDb()
    await db.update(sites).set({ isPrimary: false }).where(eq(sites.id, PRIMARY))
    clearHostingPlatformCache()
    await seedSubscription({ status: 'canceled', pausedForNonPayment: true })
    await saveStatus('active')
    expect(await siteStatus()).toBe('active')
    await db.update(sites).set({ isPrimary: true }).where(eq(sites.id, PRIMARY))
  })
})

describe('a site in a member pool', () => {
  it('asks the control plane, which holds the subscription', async () => {
    setPool('clientx')
    const hold = vi.fn().mockResolvedValue(true)
    await expect(saveStatus('active', adminId, { CONTROL_PLANE: { siteBillingHold: hold } })).rejects.toMatchObject({ statusCode: 403 })
    expect(hold).toHaveBeenCalledWith({ protocol: POOL_PROTOCOL, poolId: 'clientx', siteId: SITE })
    expect(await siteStatus()).toBe('maintenance')
  })

  it('reopens when the control plane says it is paid up', async () => {
    setPool('clientx')
    await saveStatus('active', adminId, { CONTROL_PLANE: { siteBillingHold: vi.fn().mockResolvedValue(false) } })
    expect(await siteStatus()).toBe('active')
  })

  // Release rings: a pool can run ahead of a control plane without this call for days.
  it('lets the change through when the control plane cannot answer', async () => {
    setPool('clientx')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await saveStatus('active', adminId, { CONTROL_PLANE: { siteBillingHold: vi.fn().mockRejectedValue(new Error('no such method')) } })
    expect(await siteStatus()).toBe('active')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('is answered from the control plane\'s subscription', async () => {
    await seedSubscription({ status: 'unpaid', pausedForNonPayment: true })
    expect(await siteBillingHold(getCurrentTestDb(), { protocol: POOL_PROTOCOL, siteId: SITE })).toBe(true)
    expect(await siteBillingHold(getCurrentTestDb(), { protocol: POOL_PROTOCOL, siteId: 'another-site' })).toBe(false)
  })
})
