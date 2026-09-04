/**
 * Regression test for the paywall-bypass bug: PATCHing `settings.access` in the editor
 * must actually flip `visibility` so the public gate (see pages-access.test.ts) enforces
 * it — previously no write path ever set `visibility` away from its 'public' default,
 * so members/tier-gated content was served fully public via the API regardless of the
 * "Content access" setting shown in the editor.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import patchHandler from '../../server/api/v1/content/[id].patch'
import postHandler from '../../server/api/v1/content/index.post'
import publicPageHandler from '../../server/api/public/pages/[slug].get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/analytics', () => ({
  trackPageView: vi.fn(),
}))

const SITE = 'site-content-access-write-01'
let authorUserId: string
let editorUserId: string
let typeId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'content-access-write.localhost' })
  authorUserId = await seedUser(db, { email: 'author@content-access-write.test' })
  await seedRole(db, authorUserId, SITE, 'author')
  editorUserId = await seedUser(db, { email: 'editor@content-access-write.test' })
  await seedRole(db, editorUserId, SITE, 'editor')
  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Page', singularName: 'Page' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(body: unknown, id?: string, role: 'author' | 'editor' = 'author') {
  const user = role === 'editor'
    ? { id: editorUserId, name: 'Editor', email: 'editor@content-access-write.test' }
    : { id: authorUserId, name: 'Author', email: 'author@content-access-write.test' }
  return createMockEvent({
    siteId: SITE,
    session: { user },
    body,
    params: id ? { id } : undefined,
  }) as unknown as H3Event
}

function mkPublicEvent(slug: string) {
  return createMockEvent({ siteId: SITE, params: { slug } }) as unknown as H3Event
}

describe('PATCH /api/v1/content/:id — visibility derived from settings.access', () => {
  it('gates a page after setting settings.access to members via PATCH', async () => {
    const itemId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'patch-gated-page',
      title: 'Patch Gated Page',
      status: 'published',
      visibility: 'public',
    })

    // Editor flips "Content access" to Members — this is exactly what SeoPanel.vue sends.
    await (patchHandler as HandlerFn)(mkEvent({ settings: { access: 'members' } }, itemId))

    await expect(
      (publicPageHandler as HandlerFn)(mkPublicEvent('patch-gated-page')),
    ).rejects.toMatchObject({ statusCode: 402 })
  })

  it('reopens a page after setting settings.access back to public via PATCH', async () => {
    const itemId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'patch-reopened-page',
      title: 'Patch Reopened Page',
      status: 'published',
      visibility: 'members',
      settings: { access: 'members' },
    })

    await (patchHandler as HandlerFn)(mkEvent({ settings: { access: 'public' } }, itemId))

    const result = await (publicPageHandler as HandlerFn)(mkPublicEvent('patch-reopened-page'))
    expect(result).toMatchObject({ slug: 'patch-reopened-page' })
  })

  it('leaves visibility untouched when a PATCH does not touch settings', async () => {
    const itemId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'patch-untouched-page',
      title: 'Patch Untouched Page',
      status: 'published',
      visibility: 'members',
      settings: { access: 'members' },
    })

    await (patchHandler as HandlerFn)(mkEvent({ title: 'Renamed, access unchanged' }, itemId))

    await expect(
      (publicPageHandler as HandlerFn)(mkPublicEvent('patch-untouched-page')),
    ).rejects.toMatchObject({ statusCode: 402 })
  })
})

describe('POST /api/v1/content — visibility derived from settings.access on create', () => {
  it('creates a members-gated page directly when settings.access is provided', async () => {
    // Publishing directly requires editor+ (author is limited to draft/review).
    const created = await (postHandler as HandlerFn)(mkEvent({
      title: 'New Gated Page',
      slug: 'post-gated-page',
      typeSlug: 'page',
      status: 'published',
      settings: { access: 'members' },
    }, undefined, 'editor')) as { id: string }

    await (patchHandler as HandlerFn)(mkEvent({ status: 'published' }, created.id, 'editor'))

    await expect(
      (publicPageHandler as HandlerFn)(mkPublicEvent('post-gated-page')),
    ).rejects.toMatchObject({ statusCode: 402 })
  })
})
