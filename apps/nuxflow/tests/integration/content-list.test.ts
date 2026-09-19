/**
 * Integration tests for GET /api/v1/content (listing).
 *
 * Regression coverage for a cross-tenant IDOR: the handler used to grant the
 * "see non-published content" branch to ANY caller with a valid session,
 * regardless of whether that session belonged to a member of the current
 * site. Since accounts/sessions are global across this multi-tenant install,
 * that let a user with an account on site A list site B's drafts/unpublished
 * content by hitting site B's domain directly with their own session cookie
 * or API key. Fixed to require actual `user_site_roles` membership (or
 * super-admin) on the current site before non-published statuses are shown.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/content/index.get')

type Handler = (e: H3Event) => Promise<unknown>
type ListResult = { items: { id: string; status: string }[] }

const SITE = 'site-list-01'
const OTHER_SITE = 'site-list-other-01'

let memberId: string
let strangerId: string
let superAdminId: string
let typeId: string
let publishedId: string
let draftId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'list.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'list-other.localhost' })

  memberId = await seedUser(db, { email: 'member@list.test' })
  strangerId = await seedUser(db, { email: 'stranger@list.test' })
  superAdminId = await seedUser(db, { email: 'super@list.test' })

  // memberId has an actual role on SITE.
  await seedRole(db, memberId, SITE, 'viewer')
  // strangerId only has a role on a DIFFERENT site — this is the vulnerable
  // scenario: a real, valid session with zero relationship to SITE.
  await seedRole(db, strangerId, OTHER_SITE, 'admin')
  // superAdminId has no row on SITE at all, but is a super admin elsewhere.
  await seedRole(db, superAdminId, OTHER_SITE, 'super_admin')

  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
  publishedId = await seedContentItem(db, SITE, typeId, {
    slug: 'published-item', title: 'Published Item', status: 'published',
  })
  draftId = await seedContentItem(db, SITE, typeId, {
    slug: 'draft-item', title: 'Draft Item', status: 'draft', publishedAt: null,
  })
})

afterAll(teardownTestDb)

function mkEvent(opts: { session?: { user: { id: string; name: string; email: string } } | null; apiKeyUserId?: string; query?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: opts.session ?? null,
    apiKeyUserId: opts.apiKeyUserId,
    query: opts.query,
  }) as unknown as H3Event
}

describe('GET /api/v1/content', () => {
  it('shows only published items to an unauthenticated caller', async () => {
    const result = await (listHandler as Handler)(mkEvent()) as ListResult
    expect(result.items.some(i => i.id === publishedId)).toBe(true)
    expect(result.items.some(i => i.id === draftId)).toBe(false)
  })

  it('shows drafts to a real member of this site', async () => {
    const result = await (listHandler as Handler)(mkEvent({
      session: { user: { id: memberId, name: 'Member', email: 'member@list.test' } },
    })) as ListResult
    expect(result.items.some(i => i.id === draftId)).toBe(true)
  })

  it('does NOT show drafts to a session-holder with a role on a different site only', async () => {
    const result = await (listHandler as Handler)(mkEvent({
      session: { user: { id: strangerId, name: 'Stranger', email: 'stranger@list.test' } },
    })) as ListResult
    expect(result.items.some(i => i.id === draftId)).toBe(false)
    expect(result.items.some(i => i.id === publishedId)).toBe(true)
  })

  it('does NOT let a non-member force non-published statuses via an explicit ?status= query', async () => {
    const result = await (listHandler as Handler)(mkEvent({
      session: { user: { id: strangerId, name: 'Stranger', email: 'stranger@list.test' } },
      query: { status: 'draft' },
    })) as ListResult
    expect(result.items.some(i => i.id === draftId)).toBe(false)
  })

  it('shows drafts to a super admin even with no explicit role row on this site', async () => {
    const result = await (listHandler as Handler)(mkEvent({
      session: { user: { id: superAdminId, name: 'Super', email: 'super@list.test' } },
    })) as ListResult
    expect(result.items.some(i => i.id === draftId)).toBe(true)
  })

  it('shows drafts to an API-key-authenticated request (already scoped by 03.api-key-auth.ts)', async () => {
    const result = await (listHandler as Handler)(mkEvent({ apiKeyUserId: memberId })) as ListResult
    expect(result.items.some(i => i.id === draftId)).toBe(true)
  })
})
