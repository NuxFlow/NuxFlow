/**
 * What deleting a site removes outside the database cascade, and what makes it refuse:
 *  - members' paid subscriptions are cancelled with the provider first; a provider that
 *    can't be reached refuses the deletion with nothing touched
 *  - the primary site can't go while sites in member pools remain
 *  - a copy that's part of a move can't be deleted (its files are the live copy's)
 *  - every KV key the site owns goes (every theme CSS version, plugin code, its Stream
 *    signing keys, its cache version) — and nothing of any other site's
 *  - everything under the site's R2 prefixes goes, including files with no media row
 *  - accounts created only by an invitation to the site go; real ones stay
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq, ne } from 'drizzle-orm'
import { ulid } from 'ulid'
import { sites, subscriptions, siteDirectory, siteInvitations, users, media } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedTier, seedSubscription, seedMedia } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { cancelNow, providerDelete } = vi.hoisted(() => ({
  cancelNow: vi.fn(async (_id: string) => ({})),
  providerDelete: vi.fn(async (_key: string) => {}),
}))
vi.mock('../../server/utils/payments/resolve', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getConfiguredPaymentProvider: vi.fn(async () => ({ cancelSubscription: vi.fn(), cancelSubscriptionNow: cancelNow })),
}))
vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(async () => ({ name: 'cloudflare', upload: vi.fn(), delete: providerDelete, getUrl: vi.fn() })),
}))

const { deleteSiteCompletely } = await import('../../server/utils/site-deletion')

type MockEvent = ReturnType<typeof createMockEvent> & { context: Record<string, unknown> }

function fakeKv() {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k: string) => data.get(k) ?? null,
    put: async (k: string, v: string) => { data.set(k, v) },
    delete: async (k: string) => { data.delete(k) },
    list: async ({ prefix }: { prefix?: string }) => ({ keys: [...data.keys()].filter(k => !prefix || k.startsWith(prefix)).map(name => ({ name })), list_complete: true }),
  }
}

function fakeBucket() {
  const keys = new Set<string>()
  return {
    keys,
    async delete(k: string | string[]) { for (const key of Array.isArray(k) ? k : [k]) keys.delete(key) },
    async list({ prefix = '', cursor, limit = 1000 }: { prefix?: string; cursor?: string; limit?: number }) {
      const all = [...keys].filter(k => k.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const truncated = start + limit < all.length
      return { objects: all.slice(start, start + limit).map(key => ({ key })), truncated, cursor: truncated ? String(start + limit) : undefined }
    },
  }
}

let kv = fakeKv()
let bucket = fakeBucket()
const OPERATOR_SITE = 'site-delc-operator'

function mkEvent(): H3Event {
  const event = createMockEvent({ siteId: OPERATOR_SITE }) as MockEvent
  event.context.cloudflare = { env: { PLUGIN_KV: kv, MEDIA_BUCKET: bucket }, context: { waitUntil: () => {} } }
  return event as unknown as H3Event
}

const siteExists = async (id: string) => !!(await getCurrentTestDb().query.sites.findFirst({ where: eq(sites.id, id) }))

beforeAll(async () => {
  await initTestDb()
  await seedSite(getCurrentTestDb(), { id: OPERATOR_SITE, domain: 'operator.localhost' })
})
afterAll(teardownTestDb)
beforeEach(() => {
  kv = fakeKv()
  bucket = fakeBucket()
  cancelNow.mockReset()
  cancelNow.mockResolvedValue({})
  providerDelete.mockClear()
})

describe('members\' paid subscriptions', () => {
  it('are cancelled with the provider before the site goes — not free tiers or ones already over', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'site-delc-members', domain: 'members.localhost' })
    const tierId = await seedTier(db, siteId)
    const member = await seedUser(db, { email: 'member@delc.test' })
    await seedRole(db, member, siteId, 'member')
    await seedSubscription(db, siteId, member, tierId, { providerSubscriptionId: 'sub_paid' })
    await seedSubscription(db, siteId, member, tierId, { providerSubscriptionId: 'sub_late', status: 'past_due' })
    await seedSubscription(db, siteId, member, tierId, { providerSubscriptionId: 'free_123' })
    await seedSubscription(db, siteId, member, tierId, { providerSubscriptionId: 'sub_over', status: 'cancelled' })

    await deleteSiteCompletely(mkEvent(), siteId, null)

    expect(cancelNow.mock.calls.map(c => c[0]).sort()).toEqual(['sub_late', 'sub_paid'])
    expect(await siteExists(siteId)).toBe(false)
  })

  it('refuses the deletion when the provider can\'t cancel one, and touches nothing else', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'site-delc-refuse', domain: 'refuse.localhost' })
    const tierId = await seedTier(db, siteId)
    const member = await seedUser(db, { email: 'member-refuse@delc.test' })
    await seedRole(db, member, siteId, 'member')
    await seedSubscription(db, siteId, member, tierId, { providerSubscriptionId: 'sub_stuck' })
    bucket.keys.add(`${siteId}/photo.jpg`)
    kv.data.set(`theme:${siteId}:t1:css:v1`, 'css')
    cancelNow.mockRejectedValueOnce(new Error('Stripe is down'))

    await expect(deleteSiteCompletely(mkEvent(), siteId, null)).rejects.toMatchObject({ statusCode: 409 })

    expect(await siteExists(siteId)).toBe(true)
    expect(bucket.keys.has(`${siteId}/photo.jpg`)).toBe(true)
    expect(kv.data.has(`theme:${siteId}:t1:css:v1`)).toBe(true)
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, 'sub_stuck'))
    expect(sub?.status).toBe('active')
  })
})

describe('refusals', () => {
  it('the primary site can\'t go while a member pool still has sites', async () => {
    const db = getCurrentTestDb()
    const primary = await seedSite(db, { id: 'site-delc-primary', domain: 'primary.localhost', isPrimary: true })
    // Leave only the pool's site to block: no other sites here.
    const others = await db.select().from(sites).where(ne(sites.id, primary))
    await db.delete(sites).where(ne(sites.id, primary))
    await db.insert(siteDirectory).values([
      { hostname: 'shop.pool.test', poolId: 'clienta', poolSiteId: 'pool-site-1' },
      { hostname: 'www.shop.example', poolId: 'clienta', poolSiteId: 'pool-site-1' },
    ])
    try {
      // One entry per pool site, by its main address — not one per hostname.
      await expect(deleteSiteCompletely(mkEvent(), primary, null)).rejects.toMatchObject({
        statusCode: 409,
        data: { blockingSites: [{ id: 'pool-site-1', domain: 'shop.pool.test' }] },
      })
      expect(await siteExists(primary)).toBe(true)
    }
    finally {
      await db.delete(siteDirectory)
      await db.delete(sites).where(eq(sites.id, primary))
      if (others.length) await db.insert(sites).values(others)
    }
  })

  it('a copy that\'s part of a move can\'t be deleted', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'site-delc-moved', domain: 'moved.localhost', moveState: 'moved' })
    bucket.keys.add(`${siteId}/shared.jpg`)
    await expect(deleteSiteCompletely(mkEvent(), siteId, null)).rejects.toMatchObject({ statusCode: 409 })
    expect(bucket.keys.has(`${siteId}/shared.jpg`)).toBe(true)
    expect(await siteExists(siteId)).toBe(true)
  })
})

describe('outside the database', () => {
  it('removes every KV key the site owns, and no other site\'s', async () => {
    const siteId = await seedSite(getCurrentTestDb(), { id: 'site-delc-kv', domain: 'kv.localhost' })
    const mine = [
      `theme:${siteId}:t1:css:v1`, `theme:${siteId}:t1:css:v2`, `theme:${siteId}:t1:demo`,
      `plugin:${siteId}:p1:server:abc`, `plugin:${siteId}:p1:client:abc`,
      `stream-key:site:${siteId}:acct1`, `cache-version:${siteId}`,
    ]
    const theirs = [`theme:${OPERATOR_SITE}:t1:css:v1`, `cache-version:${OPERATOR_SITE}`, 'stream-key:platform:acct1']
    for (const k of [...mine, ...theirs]) kv.data.set(k, 'x')

    await deleteSiteCompletely(mkEvent(), siteId, null)

    expect([...kv.data.keys()].sort()).toEqual([...theirs].sort())
  })

  it('removes everything under the site\'s R2 prefixes — files without a row too — and asks the provider only for the rest', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'site-delc-r2', domain: 'r2.localhost' })
    await seedMedia(db, siteId, { storageProvider: 'r2', storageKey: `${siteId}/a.jpg` })
    await seedMedia(db, siteId, { storageProvider: 'cloudflare', storageKey: `${siteId}/images/b` })
    for (const k of [`${siteId}/a.jpg`, `${siteId}/themes/x/hero.jpg`, `_private/${siteId}/email/m1.eml`, `${OPERATOR_SITE}/keep.jpg`, `_private/${OPERATOR_SITE}/email/keep.eml`]) bucket.keys.add(k)

    const { failedMediaDeletes } = await deleteSiteCompletely(mkEvent(), siteId, null)

    expect([...bucket.keys].sort()).toEqual([`${OPERATOR_SITE}/keep.jpg`, `_private/${OPERATOR_SITE}/email/keep.eml`].sort())
    expect(providerDelete.mock.calls.map(c => c[0])).toEqual([`${siteId}/images/b`])
    expect(failedMediaDeletes).toEqual([])
    expect(await db.select().from(media).where(eq(media.siteId, siteId))).toEqual([])
  })
})

describe('accounts', () => {
  it('deletes accounts created only by an invitation to the site; keeps verified and still-needed ones', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'site-delc-invites', domain: 'invites.localhost' })
    const other = await seedSite(db, { id: 'site-delc-invites-other', domain: 'invites-other.localhost' })
    const unclaimed = await seedUser(db, { email: 'unclaimed@delc.test', emailVerified: false })
    const verified = await seedUser(db, { email: 'verified@delc.test', emailVerified: true })
    const elsewhere = await seedUser(db, { email: 'elsewhere@delc.test', emailVerified: false })
    const expires = new Date(Date.now() + 86_400_000).toISOString()
    await db.insert(siteInvitations).values([
      { id: ulid(), siteId, userId: unclaimed, role: 'editor', expiresAt: expires },
      { id: ulid(), siteId, userId: verified, role: 'editor', expiresAt: expires },
      { id: ulid(), siteId, userId: elsewhere, role: 'editor', expiresAt: expires },
      { id: ulid(), siteId: other, userId: elsewhere, role: 'author', expiresAt: expires },
    ])

    await deleteSiteCompletely(mkEvent(), siteId, null)

    const left = (await db.select({ id: users.id }).from(users)).map(u => u.id)
    expect(left).not.toContain(unclaimed)
    expect(left).toContain(verified)
    expect(left).toContain(elsewhere)
  })
})
