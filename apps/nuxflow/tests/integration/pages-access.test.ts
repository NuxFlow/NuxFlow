import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedContentType, seedContentItem, seedTier, seedSubscription } from '../helpers/seed'
import handler from '../../server/api/public/pages/[slug].get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-pages-01'
let typeId: string
let publicSlug: string
let membersSlug: string
let privateSlug: string
let tieredSlug: string
let tierId: string
let userId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'pages.localhost' })
  typeId = await seedContentType(db, SITE)
  userId = await seedUser(db, { email: 'reader@pages.test' })
  tierId = await seedTier(db, SITE, { name: 'Pro' })

  publicSlug = 'public-page'
  await seedContentItem(db, SITE, typeId, {
    slug: publicSlug,
    title: 'Public Page',
    visibility: 'public',
  })

  membersSlug = 'members-page'
  await seedContentItem(db, SITE, typeId, {
    slug: membersSlug,
    title: 'Members Page',
    visibility: 'members',
    settings: JSON.stringify({ access: 'members' }),
  })

  privateSlug = 'private-page'
  await seedContentItem(db, SITE, typeId, {
    slug: privateSlug,
    title: 'Private Page',
    visibility: 'private',
  })

  tieredSlug = 'tiered-page'
  await seedContentItem(db, SITE, typeId, {
    slug: tieredSlug,
    title: 'Tiered Page',
    visibility: 'members',
    settings: JSON.stringify({ access: `tier:${tierId}` }),
  })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(slug: string, session?: { user: { id: string; name: string; email: string } } | null) {
  return createMockEvent({
    siteId: SITE,
    params: { slug },
    session: session ?? null,
  }) as unknown as H3Event
}

describe('Public pages API — content gating', () => {
  it('returns a public page for anonymous visitors', async () => {
    const result = await (handler as HandlerFn)(mkEvent(publicSlug))
    expect(result).toMatchObject({ slug: publicSlug, title: 'Public Page' })
  })

  it('throws 404 for a non-existent slug', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent('does-not-exist')),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 402 for members-only content when visitor is not logged in', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(membersSlug, null)),
    ).rejects.toMatchObject({
      statusCode: 402,
      data: expect.objectContaining({ gated: true }),
    })
  })

  it('throws 402 for members-only content when logged-in user has no active subscription', async () => {
    const event = mkEvent(membersSlug, { user: { id: userId, name: 'Reader', email: 'reader@pages.test' } })
    await expect(
      (handler as HandlerFn)(event),
    ).rejects.toMatchObject({
      statusCode: 402,
      data: expect.objectContaining({ gated: true }),
    })
  })

  it('allows access to members-only content for a subscribed user', async () => {
    const db = getCurrentTestDb()
    await seedSubscription(db, SITE, userId, tierId, { status: 'active' })

    const event = mkEvent(membersSlug, { user: { id: userId, name: 'Reader', email: 'reader@pages.test' } })
    const result = await (handler as HandlerFn)(event)
    expect(result).toMatchObject({ slug: membersSlug })
  })

  it('throws 402 for private content (never accessible via public API)', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(privateSlug)),
    ).rejects.toMatchObject({ statusCode: 402 })
  })

  it('includes available tiers in the 402 response data', async () => {
    try {
      await (handler as HandlerFn)(mkEvent(tieredSlug, null))
      expect.fail('Expected 402')
    } catch (err) {
      const e = err as { statusCode: number; data: { tiers: unknown[] } }
      expect(e.statusCode).toBe(402)
      expect(Array.isArray(e.data.tiers)).toBe(true)
    }
  })

  it('sets Cache-Control: public for public pages', async () => {
    const event = mkEvent(publicSlug)
    await (handler as HandlerFn)(event)
    const headers = (event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    expect(headers['Cache-Control']).toBe('public, max-age=3600, stale-while-revalidate=86400')
  })

  it('sets Cache-Control: private for members-only pages accessed by a valid subscriber', async () => {
    // userId already has an active subscription from the 'allows access' test above
    const event = mkEvent(membersSlug, { user: { id: userId, name: 'Reader', email: 'reader@pages.test' } })
    await (handler as HandlerFn)(event)
    const headers = (event as unknown as { _responseHeaders: Record<string, string> })._responseHeaders
    expect(headers['Cache-Control']).toBe('private, no-store')
  })
})
