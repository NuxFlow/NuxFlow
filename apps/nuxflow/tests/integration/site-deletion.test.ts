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
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem, seedMedia } from '../helpers/seed'
import { sites, contentItems, contentTypes, userSiteRoles, themes, dynamicPlugins, media } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import deleteSettingsHandler from '../../server/api/v1/settings/index.delete'
import { deleteSiteCompletely } from '../../server/utils/site-deletion'
import { getActiveProvider } from '../../server/utils/media-providers/index'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/media-providers/index', () => ({
  getActiveProvider: vi.fn(),
}))

const { mockDeleteThemeCSS, mockDeleteThemeDemo, mockDeletePluginAssets } = vi.hoisted(() => ({
  mockDeleteThemeCSS: vi.fn().mockResolvedValue(undefined),
  mockDeleteThemeDemo: vi.fn().mockResolvedValue(undefined),
  mockDeletePluginAssets: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../server/utils/cf-env', () => ({
  deleteThemeCSS: mockDeleteThemeCSS,
  deleteThemeDemo: mockDeleteThemeDemo,
  deletePluginAssets: mockDeletePluginAssets,
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

describe('deleteSiteCompletely — media failures and KV cleanup', () => {
  it('reports a failed media delete without blocking the rest of the deletion', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'del-media-fail-01', domain: 'del-media-fail.localhost' })
    const userId = await seedUser(db, { email: 'admin-media-fail@example.com' })
    await seedRole(db, userId, siteId, 'admin')
    const mediaId = await seedMedia(db, siteId, { storageKey: 'media/will-fail.jpg' })

    vi.mocked(getActiveProvider).mockResolvedValue({
      upload: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error('provider unreachable')),
      getUrl: vi.fn(),
    })

    const event = mkEvent(siteId, userId)
    const result = await deleteSiteCompletely(event, siteId, userId)

    expect(result.failedMediaDeletes).toEqual(['media/will-fail.jpg'])
    // The site (and the media row) is still fully gone from D1 even though the
    // provider-side file delete failed — only the file itself may be left behind.
    expect(await db.query.sites.findFirst({ where: eq(sites.id, siteId) })).toBeUndefined()
    expect(await db.query.media.findFirst({ where: eq(media.id, mediaId) })).toBeUndefined()
  })

  it('cleans up KV-stored theme and plugin assets before the D1 rows are cascade-deleted', async () => {
    const db = getCurrentTestDb()
    const siteId = await seedSite(db, { id: 'del-kv-cleanup-01', domain: 'del-kv-cleanup.localhost' })
    const userId = await seedUser(db, { email: 'admin-kv-cleanup@example.com' })
    await seedRole(db, userId, siteId, 'admin')

    const themeId = 'theme-kv-cleanup-01'
    await db.insert(themes).values({ id: themeId, siteId, packageName: 'test-theme', name: 'Test Theme', version: '1.0.0' })
    const pluginId = 'plugin-kv-cleanup-01'
    await db.insert(dynamicPlugins).values({ id: pluginId, siteId, name: 'Test Plugin', version: '1.0.0' })

    vi.mocked(getActiveProvider).mockResolvedValue({ upload: vi.fn(), delete: vi.fn().mockResolvedValue(undefined), getUrl: vi.fn() })
    mockDeleteThemeCSS.mockClear()
    mockDeleteThemeDemo.mockClear()
    mockDeletePluginAssets.mockClear()

    const event = mkEvent(siteId, userId)
    await deleteSiteCompletely(event, siteId, userId)

    expect(mockDeleteThemeCSS).toHaveBeenCalledWith(event, siteId, themeId)
    expect(mockDeleteThemeDemo).toHaveBeenCalledWith(event, siteId, themeId)
    expect(mockDeletePluginAssets).toHaveBeenCalledWith(event, siteId, pluginId)
    expect(await db.query.sites.findFirst({ where: eq(sites.id, siteId) })).toBeUndefined()
  })
})
