/**
 * Integration tests for DELETE /api/v1/settings (server/api/v1/settings/index.delete.ts)
 * and the underlying server/utils/site-deletion.ts helper.
 *
 * Behaviour under test:
 *  - Deleting the only site in the installation fully removes it, wasLastSite: true
 *    (the client then redirects to fresh-install onboarding).
 *  - Deleting the "main" (oldest) site while other sites still exist is blocked with 409
 *    and the list of blocking sites — nothing is touched.
 *  - Deleting a non-main ("addon") site while other sites exist is a full delete too
 *    (wasLastSite: false) — the row is dropped entirely, not reset/kept, so it doesn't
 *    linger as a phantom entry blocking a later main-site deletion.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { sites, contentItems, contentTypes, userSiteRoles } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import deleteSettingsHandler from '../../server/api/v1/settings/index.delete'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(),
}))

type Handler = (e: H3Event) => Promise<unknown>

function mkEvent(siteId: string, userId: string) {
  return createMockEvent({
    siteId,
    session: { user: { id: userId, name: 'Test Admin', email: `${userId.toLowerCase()}@example.com` } },
  }) as unknown as H3Event
}

async function cleanupSites(...siteIds: string[]) {
  const db = getCurrentTestDb()
  for (const id of siteIds) {
    await db.delete(userSiteRoles).where(eq(userSiteRoles.siteId, id))
    await db.delete(sites).where(eq(sites.id, id))
  }
}

beforeAll(initTestDb)
afterAll(teardownTestDb)

describe('DELETE /api/v1/settings', () => {
  it('fully deletes the only site in the installation, reporting wasLastSite: true', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'only-site-01', domain: 'only.localhost', name: 'Only Site' })
    const userId = await seedUser(db, { email: 'admin-only@example.com' })
    await seedRole(db, userId, siteId, 'super_admin')

    const res = await (deleteSettingsHandler as Handler)(mkEvent(siteId, userId)) as { id: string; wasLastSite: boolean }

    expect(res.wasLastSite).toBe(true)

    const row = await db.query.sites.findFirst({ where: eq(sites.id, siteId) })
    expect(row).toBeUndefined()
  })

  it('blocks deleting the main (oldest) site while another site still exists', async () => {
    const db = getCurrentTestDb()
    const mainId = await seedSite(db, {
      id: 'blocked-main-01', domain: 'main.localhost', name: 'Main Site',
      createdAt: '2026-01-01 00:00:00',
    })
    const addonId = await seedSite(db, {
      id: 'blocked-addon-01', domain: 'addon.localhost', name: 'Addon Site',
      createdAt: '2026-02-01 00:00:00',
    })
    const userId = await seedUser(db, { email: 'admin-blocked@example.com' })
    await seedRole(db, userId, mainId, 'super_admin')

    await expect((deleteSettingsHandler as Handler)(mkEvent(mainId, userId)))
      .rejects.toMatchObject({
        statusCode: 409,
        data: { blockingSites: [expect.objectContaining({ id: addonId, domain: 'addon.localhost' })] },
      })

    // Neither site was touched
    expect(await db.query.sites.findFirst({ where: eq(sites.id, mainId) })).toBeDefined()
    expect(await db.query.sites.findFirst({ where: eq(sites.id, addonId) })).toBeDefined()

    await cleanupSites(mainId, addonId)
  })

  it('fully deletes a non-main site while other sites exist, leaving no phantom row behind', async () => {
    const db = getCurrentTestDb()
    const mainId = await seedSite(db, {
      id: 'addon-del-main-01', domain: 'addon-del-main.localhost', name: 'Main Site',
      createdAt: '2026-01-01 00:00:00',
    })
    const addonId = await seedSite(db, {
      id: 'addon-del-addon-01', domain: 'addon-del-addon.localhost', name: 'Addon Site',
      createdAt: '2026-02-01 00:00:00', setupCompleted: true,
    })
    const userId = await seedUser(db, { email: 'admin-addon-del@example.com' })
    await seedRole(db, userId, addonId, 'super_admin')

    const typeId = await seedContentType(db, addonId)
    await seedContentItem(db, addonId, typeId)

    const res = await (deleteSettingsHandler as Handler)(mkEvent(addonId, userId)) as { id: string; wasLastSite: boolean }

    expect(res.wasLastSite).toBe(false)

    // The row is gone entirely — not reset, not kept around
    expect(await db.query.sites.findFirst({ where: eq(sites.id, addonId) })).toBeUndefined()

    // Its data was wiped
    expect(await db.query.contentItems.findFirst({ where: eq(contentItems.siteId, addonId) })).toBeUndefined()
    expect(await db.query.contentTypes.findFirst({ where: eq(contentTypes.siteId, addonId) })).toBeUndefined()
    expect(await db.query.userSiteRoles.findFirst({ where: eq(userSiteRoles.siteId, addonId) })).toBeUndefined()

    // The main site is untouched, and no longer sees the addon site as a blocker
    const remaining = await db.query.sites.findMany({ where: eq(sites.id, mainId) })
    expect(remaining).toHaveLength(1)

    await cleanupSites(mainId, addonId)
  })
})
