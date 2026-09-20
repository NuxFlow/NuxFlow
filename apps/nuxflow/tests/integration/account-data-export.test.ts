import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import {
  seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia, seedTier, seedSubscription,
} from '../helpers/seed'
import handler from '../../server/api/v1/account/data-export.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-data-export-01'
let userId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(uid: string | null) {
  return createMockEvent({
    siteId: SITE,
    session: uid ? { user: { id: uid, name: 'Export User', email: `${uid}@export.test` } } : null,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'export.localhost' })
  userId = await seedUser(db, { email: 'export-subject@export.test' })
  await seedRole(db, userId, SITE, 'editor')
})

afterAll(teardownTestDb)

describe('GET /api/v1/account/data-export', () => {
  it('throws 401 when not authenticated', async () => {
    await expect((handler as HandlerFn)(mkEvent(null))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('exports the caller\'s own profile, roles, content, media, and subscriptions — nothing else', async () => {
    const db = getCurrentTestDb()

    const otherUserId = await seedUser(db, { email: 'someone-else@export.test' })
    await seedRole(db, otherUserId, SITE, 'editor')

    const typeId = await seedContentType(db, SITE)
    const ownItemId = await seedContentItem(db, SITE, typeId, { authorId: userId, title: 'My Page' })
    await seedContentItem(db, SITE, typeId, { authorId: otherUserId, title: 'Someone Else\'s Page' })

    const ownMediaId = await seedMedia(db, SITE, { uploadedBy: userId })
    await seedMedia(db, SITE, { uploadedBy: otherUserId })

    const tierId = await seedTier(db, SITE)
    await seedSubscription(db, SITE, userId, tierId, { status: 'active' })

    const result = await (handler as HandlerFn)(mkEvent(userId)) as {
      profile: { id: string; email: string }
      siteRoles: Array<{ siteId: string; role: string }>
      authoredContent: Array<{ id: string; title: string }>
      uploadedMedia: Array<{ id: string }>
      subscriptions: Array<{ siteId: string; status: string }>
    }

    expect(result.profile.id).toBe(userId)
    expect(result.profile.email).toBe('export-subject@export.test')

    expect(result.siteRoles).toEqual([expect.objectContaining({ siteId: SITE, role: 'editor' })])

    expect(result.authoredContent.map(c => c.id)).toEqual([ownItemId])
    expect(result.uploadedMedia.map(m => m.id)).toEqual([ownMediaId])
    expect(result.subscriptions).toHaveLength(1)
    expect(result.subscriptions[0]!.status).toBe('active')
  })

  it('throws 404 for a session referencing a since-deleted user', async () => {
    await expect((handler as HandlerFn)(mkEvent('nonexistent-user-id'))).rejects.toMatchObject({ statusCode: 404 })
  })
})
