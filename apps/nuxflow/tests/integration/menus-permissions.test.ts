/**
 * Regression coverage for the menus write routes' role requirement.
 *
 * All three (create/update/delete) previously used requireAuth() — any
 * authenticated user on the site's domain, regardless of role, including the
 * 'viewer' default requireAuth() falls back to for a user with no explicit
 * user_site_roles row. That let a bare authenticated visitor (e.g. a
 * self-registered 'member' on a site with public registration enabled) edit
 * site navigation, including the header/footer, and trigger a full public-page
 * cache purge. Fixed to requireRole(event, 'editor'), matching every other
 * content-mutation route in this codebase (content, taxonomies, media).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { menus } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import createMenuHandler from '../../server/api/v1/menus/index.post'
import updateMenuHandler from '../../server/api/v1/menus/[id].patch'
import deleteMenuHandler from '../../server/api/v1/menus/[id].delete'
import type * as CfEnv from '../../server/utils/cf-env'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/edge-cache', () => ({
  purgeEdgeCache: vi.fn().mockResolvedValue(undefined),
  purgeAllPublicPages: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  waitUntil: (_event: unknown, promise: Promise<unknown>) => { void promise },
}))

const SITE = 'site-menus-perms-01'
let viewerId: string
let editorId: string
let menuId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(userId: string, opts: { params?: Record<string, string>; body?: unknown } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Test', email: 'test@menus-perms.test' } },
    params: opts.params,
    body: opts.body,
  }) as unknown as H3Event
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'menus-perms.localhost' })
  // No explicit role row — requireAuth()/requireRole() falls back to 'viewer' for this user.
  viewerId = await seedUser(db, { email: 'viewer@menus-perms.test' })
  editorId = await seedUser(db, { email: 'editor@menus-perms.test' })
  await seedRole(db, editorId, SITE, 'editor')

  menuId = ulid()
  await db.insert(menus).values({ id: menuId, siteId: SITE, name: 'Main Menu', location: null, items: [] })
})

afterAll(teardownTestDb)

describe('menus write routes require editor role', () => {
  it('POST /api/v1/menus rejects a viewer-level caller with 403', async () => {
    await expect(
      (createMenuHandler as HandlerFn)(mkEvent(viewerId, { body: { name: 'New Menu' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('POST /api/v1/menus succeeds for an editor', async () => {
    const result = await (createMenuHandler as HandlerFn)(
      mkEvent(editorId, { body: { name: 'Editor Menu' } }),
    ) as { id: string }
    expect(result.id).toBeTruthy()
  })

  it('PATCH /api/v1/menus/:id rejects a viewer-level caller with 403', async () => {
    await expect(
      (updateMenuHandler as HandlerFn)(mkEvent(viewerId, { params: { id: menuId }, body: { name: 'Hacked' } })),
    ).rejects.toMatchObject({ statusCode: 403 })

    const db = getCurrentTestDb()
    const row = await db.query.menus.findFirst({ where: eq(menus.id, menuId) })
    expect(row?.name).toBe('Main Menu') // untouched
  })

  it('DELETE /api/v1/menus/:id rejects a viewer-level caller with 403', async () => {
    await expect(
      (deleteMenuHandler as HandlerFn)(mkEvent(viewerId, { params: { id: menuId } })),
    ).rejects.toMatchObject({ statusCode: 403 })

    const db = getCurrentTestDb()
    const row = await db.query.menus.findFirst({ where: eq(menus.id, menuId) })
    expect(row).toBeTruthy() // still exists
  })
})
