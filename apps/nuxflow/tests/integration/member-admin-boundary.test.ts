/**
 * Members are site visitors, not the team.
 *
 * `member` is the role public sign-up, the accounts-origin "join" and memberships hand out.
 * It used to pass requireAuth() (any role row) and even requireRole('viewer') (member ranks
 * above viewer), so anyone who registered on a site could list its drafts, read any item's
 * full body by id — drafts, private pages, paid-tier pages, password-protected galleries —
 * and browse the whole media library. These tests pin the boundary: no admin data for a
 * member, while their own notifications still work.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { apiKeys } from '@nuxflow/db/schema'
import { ulid } from 'ulid'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia } from '../helpers/seed'
import { bufferToHex } from '../../server/utils/buffer'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const { default: listHandler } = await import('../../server/api/v1/content/index.get')
const { default: getHandler } = await import('../../server/api/v1/content/[id].get')
const { default: mediaListHandler } = await import('../../server/api/v1/media/index.get')
const { default: calendarHandler } = await import('../../server/api/v1/content/calendar.get')
const { default: notificationsHandler } = await import('../../server/api/v1/notifications/index.get')
const { default: apiKeyMiddleware } = await import('../../server/middleware/03.api-key-auth')

type Handler = (e: H3Event) => Promise<unknown>
type ListResult = { items: { id: string; slug: string }[] }

const SITE = 'site-member-boundary'

let memberId: string
let viewerId: string
let typeId: string
let draftId: string
let tierPageId: string

const asUser = (id: string, extra: Parameters<typeof createMockEvent>[0] = {}) => createMockEvent({
  siteId: SITE,
  session: { user: { id, name: 'U', email: `${id}@boundary.test` } },
  ...extra,
}) as unknown as H3Event

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'boundary.localhost' })

  memberId = await seedUser(db, { email: 'member@boundary.test' })
  await seedRole(db, memberId, SITE, 'member')
  viewerId = await seedUser(db, { email: 'viewer@boundary.test' })
  await seedRole(db, viewerId, SITE, 'viewer')

  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
  await seedContentItem(db, SITE, typeId, { slug: 'open-page', title: 'Open' })
  draftId = await seedContentItem(db, SITE, typeId, { slug: 'secret-draft', title: 'Draft', status: 'draft', publishedAt: null })
  tierPageId = await seedContentItem(db, SITE, typeId, {
    slug: 'premium', title: 'Premium', visibility: 'members', settings: { access: 'tier:gold' },
  })
  await seedContentItem(db, SITE, typeId, {
    slug: 'smith-wedding', title: 'Gallery', visibility: 'password', settings: { access: 'password', passwordHash: 'x' },
  })
  await seedMedia(db, SITE)
})

afterAll(teardownTestDb)

describe('a member gets no admin data', () => {
  it('cannot read a draft by id', async () => {
    await expect((getHandler as Handler)(asUser(memberId, { params: { id: draftId } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('cannot read a paid-tier page by id (no paywall bypass)', async () => {
    await expect((getHandler as Handler)(asUser(memberId, { params: { id: tierPageId } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('cannot list the media library', async () => {
    await expect((mediaListHandler as Handler)(asUser(memberId))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('cannot open the editorial calendar (a viewer-floor route)', async () => {
    await expect((calendarHandler as Handler)(asUser(memberId, { query: { from: '2020-01-01', to: '2030-01-01' } }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('sees only published public items in the content list, even asking for drafts', async () => {
    const res = await (listHandler as Handler)(asUser(memberId, { query: { type: 'page', status: 'draft' } })) as ListResult
    expect(res.items.map(i => i.slug)).toEqual(['open-page'])
  })

  it('still reaches their own notifications', async () => {
    await expect((notificationsHandler as Handler)(asUser(memberId))).resolves.toBeDefined()
  })
})

describe('the team is unaffected', () => {
  it('a viewer still reads a draft by id', async () => {
    const res = await (getHandler as Handler)(asUser(viewerId, { params: { id: draftId } })) as { id: string }
    expect(res.id).toBe(draftId)
  })

  it('a viewer still lists every status', async () => {
    const res = await (listHandler as Handler)(asUser(viewerId, { query: { type: 'page' } })) as ListResult
    expect(res.items).toHaveLength(4)
  })
})

describe('anonymous visitors', () => {
  it('do not see members-only or password-protected titles in the content list', async () => {
    const res = await (listHandler as Handler)(createMockEvent({ siteId: SITE, query: { type: 'page' } }) as unknown as H3Event) as ListResult
    expect(res.items.map(i => i.slug)).toEqual(['open-page'])
  })
})

describe('API keys', () => {
  it('stop working once the owner is only a member', async () => {
    const raw = 'nf_member_owned_key_123'
    const keyHash = bufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))
    await getCurrentTestDb().insert(apiKeys).values({ id: ulid(), siteId: SITE, userId: memberId, name: 'old key', keyHash, scopes: ['read:content'], expiresAt: null })
    const event = createMockEvent({ siteId: SITE, headers: { authorization: `Bearer ${raw}` } }) as unknown as H3Event
    await (apiKeyMiddleware as Handler)(event)
    expect(event.context.apiKeyUserId).toBeUndefined()
  })
})
