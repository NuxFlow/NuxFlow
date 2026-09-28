/**
 * Tenant boundaries that don't depend on sign-in: settings a tenant must not control,
 * deployment credentials only the primary site inherits, the shared email sender, inbound
 * handle uniqueness, and per-site plugin ids.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { dynamicPlugins, siteSettings, sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const PRIMARY = 'site-tenancy-primary'
const TENANT = 'site-tenancy-tenant'
const OTHER = 'site-tenancy-other'

const { default: patchHandler } = await import('../../server/api/v1/settings/index.patch')
const { resolveSetting } = await import('../../server/utils/settings')
const { clearSiteInfoCache } = await import('../../server/utils/site-info')
const { assertSharedSenderAllowed } = await import('../../server/utils/email')
const { ensureInboundHandle } = await import('../../server/utils/inbox')

type Handler = (e: H3Event) => Promise<unknown>

let adminId: string
let operatorId: string
const originalRuntimeConfig = globalThis.useRuntimeConfig

function ev(siteId: string, userId: string, body: unknown = {}) {
  return createMockEvent({ siteId, body, session: { user: { id: userId, name: 'U', email: `${userId}@t.test` } } }) as unknown as H3Event
}

beforeAll(async () => {
  const base = originalRuntimeConfig()
  globalThis.useRuntimeConfig = () => ({
    ...base,
    stripeSecretKey: 'sk_live_OPERATOR',
    resendApiKey: 're_OPERATOR',
    openaiApiKey: 'sk-openai-shared',
    inboundEmailDomain: 'mail.platform.test',
  })
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: PRIMARY, domain: 'platform.test', isPrimary: true })
  await seedSite(db, { id: TENANT, domain: 'www.tenant.test' })
  await seedSite(db, { id: OTHER, domain: 'other.test' })
  adminId = await seedUser(db, { email: 'tenant-admin@t.test' })
  operatorId = await seedUser(db, { email: 'operator@t.test' })
  await seedRole(db, adminId, TENANT, 'admin')
  await seedRole(db, operatorId, PRIMARY, 'super_admin')
  clearSiteInfoCache()
})

afterAll(async () => {
  globalThis.useRuntimeConfig = originalRuntimeConfig
  await teardownTestDb()
})

describe('settings a tenant admin must not control', () => {
  it('refuses the server-managed inbound email handle', async () => {
    await expect((patchHandler as Handler)(ev(TENANT, adminId, { settings: { 'email.inbound_handle': 'other' } })))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses a domain change from a site admin — domains are platform routing', async () => {
    await expect((patchHandler as Handler)(ev(TENANT, adminId, { domain: 'squatted.test' })))
      .rejects.toMatchObject({ statusCode: 403 })
    // Re-sending the current domain (the settings form always does) is fine.
    await expect((patchHandler as Handler)(ev(TENANT, adminId, { domain: 'WWW.Tenant.test', name: 'Renamed' }))).resolves.toBeDefined()
    const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, TENANT) })
    expect(row?.domain).toBe('www.tenant.test')
  })

  it('lets the operator change their own site\'s domain, normalized and unique', async () => {
    await expect((patchHandler as Handler)(ev(PRIMARY, operatorId, { domain: 'other.test' })))
      .rejects.toMatchObject({ statusCode: 409 })
    await (patchHandler as Handler)(ev(PRIMARY, operatorId, { domain: 'https://New-Platform.test/' }))
    const row = await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, PRIMARY) })
    expect(row?.domain).toBe('new-platform.test')
  })
})

describe('deployment credentials', () => {
  it('only the primary site inherits payment and email-provider keys from env vars', async () => {
    const onPrimary = createMockEvent({ siteId: PRIMARY }) as unknown as H3Event
    const onTenant = createMockEvent({ siteId: TENANT }) as unknown as H3Event
    expect(await resolveSetting(onPrimary, 'payments.stripe_secret_key', 'stripeSecretKey')).toBe('sk_live_OPERATOR')
    expect(await resolveSetting(onTenant, 'payments.stripe_secret_key', 'stripeSecretKey')).toBe('')
    expect(await resolveSetting(onTenant, 'email.resend_api_key', 'resendApiKey')).toBe('')
    // Shared AI defaults are the operator's deliberate offer to every site.
    expect(await resolveSetting(onTenant, 'ai.openai_api_key', 'openaiApiKey')).toBe('sk-openai-shared')
  })

  it('a tenant still uses its own configured key', async () => {
    await seedSetting(getCurrentTestDb(), OTHER, 'payments.ls_store_id', 'store-other')
    const event = createMockEvent({ siteId: OTHER }) as unknown as H3Event
    expect(await resolveSetting(event, 'payments.ls_store_id', 'lsStoreId')).toBe('store-other')
  })
})

describe('shared Cloudflare email sender', () => {
  const event = createMockEvent() as unknown as H3Event

  it('lets a tenant send only from its own domain (or the platform inbound domain)', async () => {
    await expect(assertSharedSenderAllowed(event, TENANT, 'hello@tenant.test')).resolves.toBeUndefined()
    await expect(assertSharedSenderAllowed(event, TENANT, 'noreply@mail.tenant.test')).resolves.toBeUndefined()
    await expect(assertSharedSenderAllowed(event, TENANT, 'handle@mail.platform.test')).resolves.toBeUndefined()
    await expect(assertSharedSenderAllowed(event, TENANT, 'billing@other.test')).rejects.toThrow(/isn't allowed/)
    await expect(assertSharedSenderAllowed(event, TENANT, 'ceo@platform.test')).rejects.toThrow()
    await expect(assertSharedSenderAllowed(event, TENANT, 'x@eviltenant.test')).rejects.toThrow()
  })

  it('does not restrict the operator\'s own site', async () => {
    await expect(assertSharedSenderAllowed(event, PRIMARY, 'anything@anywhere.test')).resolves.toBeUndefined()
  })
})

describe('inbound email handles', () => {
  it('are unique across sites at the database level', async () => {
    const db = getCurrentTestDb()
    await db.insert(siteSettings).values({ id: ulid(), siteId: OTHER, key: 'email.inbound_handle', value: 'taken' })
    await expect(db.insert(siteSettings).values({ id: ulid(), siteId: TENANT, key: 'email.inbound_handle', value: 'taken' }))
      .rejects.toThrow()
  })

  it('are allocated with a suffix when the natural one is taken', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { domain: 'taken.example' })
    const handle = await ensureInboundHandle(createMockEvent({ siteId }) as unknown as H3Event, db, siteId)
    expect(handle).toBe('taken2')
  })
})

describe('dynamic plugins', () => {
  it('can be installed on several sites under the same publisher id — but once per site', async () => {
    const db = getCurrentTestDb()
    const row = { id: 'com.example.popular', name: 'Popular', version: '1.0.0' }
    await db.insert(dynamicPlugins).values({ ...row, siteId: TENANT })
    await db.insert(dynamicPlugins).values({ ...row, siteId: OTHER })
    expect(await db.query.dynamicPlugins.findMany({ where: eq(dynamicPlugins.id, row.id) })).toHaveLength(2)
    await expect(db.insert(dynamicPlugins).values({ ...row, siteId: TENANT })).rejects.toThrow()
    const tenants = await db.query.dynamicPlugins.findFirst({ where: and(eq(dynamicPlugins.id, row.id), eq(dynamicPlugins.siteId, TENANT)) })
    expect(tenants?.name).toBe('Popular')
  })
})
