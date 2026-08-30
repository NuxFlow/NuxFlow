import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedMedia, seedMediaFolder } from '../helpers/seed'
import handler from '../../server/api/v1/media/[id].patch'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-media-patch-01'
let viewerUserId: string
let authorUserId: string
let mediaId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'media-patch.localhost' })

  viewerUserId = await seedUser(db, { email: 'viewer@media-patch.test' })
  authorUserId = await seedUser(db, { email: 'author@media-patch.test' })

  await seedRole(db, viewerUserId, SITE, 'viewer')
  await seedRole(db, authorUserId, SITE, 'author')

  mediaId = await seedMedia(db, SITE, {
    originalName: 'landscape.jpg',
    altText: null,
    caption: null,
    focalX: null,
    focalY: null,
  })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(id: string, body: unknown, userId = authorUserId, noSession = false) {
  const user = noSession ? null : { id: userId, name: 'Test', email: 'test@media-patch.test' }
  return createMockEvent({
    siteId: SITE,
    session: user ? { user } : null,
    params: { id },
    body,
  }) as unknown as H3Event
}

describe('PATCH /api/v1/media/:id', () => {
  it('returns 401 when not authenticated', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(mediaId, { altText: 'x' }, authorUserId, true)),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns 403 when user is viewer (needs author+)', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(mediaId, { altText: 'x' }, viewerUserId)),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 for a non-existent media id', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent('does-not-exist', { altText: 'x' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updates alt text', async () => {
    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { altText: 'A beautiful landscape' }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('updates caption', async () => {
    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { caption: 'Photo taken in Scotland' }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('updates focalX and focalY focal point values', async () => {
    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { focalX: 30, focalY: 70 }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('clears focal point with null values', async () => {
    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { focalX: null, focalY: null }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('updates folderId', async () => {
    const db = getCurrentTestDb()
    const folderId = await seedMediaFolder(db, SITE)

    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { folderId }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('rejects folderId belonging to another site', async () => {
    const db = getCurrentTestDb()
    const otherSite = await seedSite(db, { domain: 'media-patch-other.localhost' })
    const foreignFolderId = await seedMediaFolder(db, otherSite)

    await expect(
      (handler as HandlerFn)(mkEvent(mediaId, { folderId: foreignFolderId })),
    ).rejects.toThrow()
  })

  it('rejects focalX outside 0–100 range', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(mediaId, { focalX: 150 })),
    ).rejects.toThrow()
  })

  it('rejects focalY outside 0–100 range', async () => {
    await expect(
      (handler as HandlerFn)(mkEvent(mediaId, { focalY: -5 })),
    ).rejects.toThrow()
  })

  it('accepts a partial update (only focalX, no other fields)', async () => {
    const result = await (handler as HandlerFn)(
      mkEvent(mediaId, { focalX: 50 }),
    ) as { id: string }

    expect(result.id).toBe(mediaId)
  })

  it('returns 404 when media belongs to a different site', async () => {
    const otherSiteId = 'site-media-patch-other'
    const db = getCurrentTestDb()
    await seedSite(db, { id: otherSiteId, domain: 'other-media.localhost' })
    const otherId = await seedMedia(db, otherSiteId)

    await expect(
      (handler as HandlerFn)(mkEvent(otherId, { altText: 'cross-site' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
