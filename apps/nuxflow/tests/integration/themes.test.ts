import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { themes, auditLogs, contentItems } from '@nuxflow/db/schema'
import type { NuxFlowBackup } from '../../server/utils/backup'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const putThemeCSSMock = vi.fn().mockResolvedValue(undefined)
const putThemeDemoMock = vi.fn().mockResolvedValue(undefined)
const getThemeDemoMock = vi.fn().mockResolvedValue(null)
const deleteThemeCSSMock = vi.fn().mockResolvedValue(undefined)
const deleteThemeDemoMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../../server/utils/cf-env', () => ({
  putThemeCSS: (...args: unknown[]) => putThemeCSSMock(...args),
  putThemeDemo: (...args: unknown[]) => putThemeDemoMock(...args),
  getThemeDemo: (...args: unknown[]) => getThemeDemoMock(...args),
  deleteThemeCSS: (...args: unknown[]) => deleteThemeCSSMock(...args),
  deleteThemeDemo: (...args: unknown[]) => deleteThemeDemoMock(...args),
  getCfBindings: () => ({ kv: null }),
  getAnalyticsEngine: () => null,
  waitUntil: (_event: unknown, promise: Promise<unknown>) => { void promise },
}))

const { default: listHandler } = await import('../../server/api/v1/themes/index.get')
const { default: createHandler } = await import('../../server/api/v1/themes/index.post')
const { default: resetHandler } = await import('../../server/api/v1/themes/reset.post')
const { default: activateHandler } = await import('../../server/api/v1/themes/[id]/activate.post')
const { default: cssPatchHandler } = await import('../../server/api/v1/themes/[id]/css.patch')
const { default: deleteHandler } = await import('../../server/api/v1/themes/[id]/index.delete')
const { default: previewHandler } = await import('../../server/api/v1/themes/[id]/preview.post')
const { default: demoImportHandler } = await import('../../server/api/v1/themes/[id]/demo-import.post')

const SITE = 'site-themes-01'
const OTHER_SITE = 'site-themes-02'

let adminId: string
let editorId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'themes.localhost' })
  await seedSite(db, { id: OTHER_SITE, domain: 'themes2.localhost' })

  adminId = await seedUser(db, { email: 'admin@themes.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@themes.test', name: 'Editor' })

  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function adminEvent(opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@themes.test' } },
    body: opts.body,
    params: opts.params,
    query: opts.query,
    headers: opts.headers,
  }) as unknown as H3Event
}

function editorEvent(opts: { body?: unknown; params?: Record<string, string> } = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@themes.test' } },
    body: opts.body,
    params: opts.params,
  }) as unknown as H3Event
}

async function seedTheme(overrides: Partial<typeof themes.$inferInsert> = {}) {
  const db = getCurrentTestDb()
  const id = overrides.id ?? ulid()
  await db.insert(themes).values({
    id, siteId: SITE, packageName: `@dynamic/theme-${id}`, name: 'Test Theme', version: '1.0.0',
    isActive: false, hasCss: true,
    ...overrides,
  })
  return id
}

const MINIMAL_BACKUP: NuxFlowBackup = {
  version: '1',
  exportedAt: new Date().toISOString(),
  site: { name: 'Demo Site', locale: 'en', timezone: 'UTC' },
  settings: {},
  contentTypes: [],
  content: [],
  taxonomies: [],
  menus: [],
  forms: [],
  media: [],
  themes: [],
  plugins: [],
  users: [],
  membershipTiers: [],
}

describe('GET /api/v1/themes', () => {
  it('throws 403 for editor (below admin)', async () => {
    await expect((listHandler as Handler)(editorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists themes scoped to the current site', async () => {
    const id = await seedTheme({ name: 'Visible Theme' })
    await seedTheme({ id: ulid(), siteId: OTHER_SITE, name: 'Foreign Theme' })

    const result = await (listHandler as Handler)(adminEvent()) as { themes: { id: string; name: string }[] }
    expect(result.themes.some(t => t.id === id)).toBe(true)
    expect(result.themes.some(t => t.name === 'Foreign Theme')).toBe(false)
  })
})

describe('POST /api/v1/themes (plain CSS body)', () => {
  it('creates a theme, writes CSS via cf-env, and activates it when no theme is active yet', async () => {
    putThemeCSSMock.mockClear()
    const freshSite = `site-themes-fresh-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: freshSite, domain: `themes-fresh-${ulid()}.localhost` })
    const freshAdmin = await seedUser(db, { email: `admin-fresh-${ulid()}@test.com` })
    await seedRole(db, freshAdmin, freshSite, 'admin')

    const event = createMockEvent({
      siteId: freshSite,
      session: { user: { id: freshAdmin, name: 'Fresh Admin', email: 'admin-fresh@test.com' } },
      body: { name: 'My Theme', version: '2.0.0', css: ':root{--x:1}' },
    }) as unknown as H3Event

    const result = await (createHandler as Handler)(event) as { success: boolean; id: string; hasDemoContent: boolean }
    expect(result.success).toBe(true)
    expect(result.hasDemoContent).toBe(false)
    expect(putThemeCSSMock).toHaveBeenCalledWith(expect.anything(), freshSite, result.id, ':root{--x:1}')

    const row = await db.query.themes.findFirst({ where: and(eq(themes.id, result.id), eq(themes.siteId, freshSite)) })
    expect(row?.name).toBe('My Theme')
    expect(row?.isActive).toBe(true)

    const log = await db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.resource, 'theme'), eq(auditLogs.resourceId, result.id)),
    })
    expect(log?.action).toBe('create')
  })

  it('does not auto-activate when another theme is already active', async () => {
    await seedTheme({ isActive: true, name: 'Already Active' })

    const event = adminEvent({ body: { name: 'Second Theme', css: ':root{--y:2}' } })
    const result = await (createHandler as Handler)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.themes.findFirst({ where: eq(themes.id, result.id) })
    expect(row?.isActive).toBe(false)
  })

  it('throws 400 when name is missing', async () => {
    await expect(
      (createHandler as Handler)(adminEvent({ body: { css: ':root{}' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when css is missing', async () => {
    await expect(
      (createHandler as Handler)(adminEvent({ body: { name: 'No CSS' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 403 for editor (below admin)', async () => {
    await expect(
      (createHandler as Handler)(editorEvent({ body: { name: 'X', css: ':root{}' } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('POST /api/v1/themes/:id/activate', () => {
  it('activates the target theme and deactivates all others on the site', async () => {
    const themeA = await seedTheme({ isActive: true, name: 'A' })
    const themeB = await seedTheme({ isActive: false, name: 'B' })

    await (activateHandler as Handler)(adminEvent({ params: { id: themeB } }))

    const db = getCurrentTestDb()
    const rowA = await db.query.themes.findFirst({ where: eq(themes.id, themeA) })
    const rowB = await db.query.themes.findFirst({ where: eq(themes.id, themeB) })
    expect(rowA?.isActive).toBe(false)
    expect(rowB?.isActive).toBe(true)
  })

  it('throws 404 for a theme on another site', async () => {
    const id = await seedTheme({ id: ulid(), siteId: OTHER_SITE, name: 'Foreign' })
    await expect(
      (activateHandler as Handler)(adminEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 403 for editor (below admin)', async () => {
    const id = await seedTheme()
    await expect(
      (activateHandler as Handler)(editorEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('PATCH /api/v1/themes/:id/css', () => {
  it('updates CSS and version for a CSS theme', async () => {
    putThemeCSSMock.mockClear()
    const id = await seedTheme({ hasCss: true, version: '1.0.0' })

    await (cssPatchHandler as Handler)(adminEvent({ params: { id }, body: { css: ':root{--z:3}', version: '1.1.0' } }))

    expect(putThemeCSSMock).toHaveBeenCalledWith(expect.anything(), SITE, id, ':root{--z:3}')
    const db = getCurrentTestDb()
    const row = await db.query.themes.findFirst({ where: eq(themes.id, id) })
    expect(row?.version).toBe('1.1.0')
  })

  it('throws 400 for a non-CSS (bundled) theme', async () => {
    const id = await seedTheme({ hasCss: false })
    await expect(
      (cssPatchHandler as Handler)(adminEvent({ params: { id }, body: { css: ':root{}' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when css is empty', async () => {
    const id = await seedTheme({ hasCss: true })
    await expect(
      (cssPatchHandler as Handler)(adminEvent({ params: { id }, body: { css: '' } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('DELETE /api/v1/themes/:id', () => {
  it('deletes a CSS theme and its KV entries', async () => {
    deleteThemeCSSMock.mockClear()
    const id = await seedTheme({ hasCss: true })

    await (deleteHandler as Handler)(adminEvent({ params: { id } }))

    expect(deleteThemeCSSMock).toHaveBeenCalledWith(expect.anything(), SITE, id)
    const db = getCurrentTestDb()
    const row = await db.query.themes.findFirst({ where: eq(themes.id, id) })
    expect(row).toBeUndefined()
  })

  it('throws 400 for a bundled (non-CSS) theme', async () => {
    const id = await seedTheme({ hasCss: false })
    await expect(
      (deleteHandler as Handler)(adminEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('deletes demo-imported content when deleteDemo=true', async () => {
    const id = await seedTheme({ hasCss: true })
    const demoBackup: NuxFlowBackup = {
      ...MINIMAL_BACKUP,
      content: [{ typeSlug: 'page', slug: 'demo-page-to-delete', title: 'Demo', status: 'published', visibility: 'public' } as unknown as NuxFlowBackup['content'][number]],
    }
    getThemeDemoMock.mockResolvedValueOnce(JSON.stringify(demoBackup))

    const db = getCurrentTestDb()
    const { contentTypes } = await import('@nuxflow/db/schema')
    const typeId = ulid()
    await db.insert(contentTypes).values({ id: typeId, siteId: SITE, slug: 'page', name: 'Page', singularName: 'Page' })
    await db.insert(contentItems).values({
      id: ulid(), siteId: SITE, typeId, slug: 'demo-page-to-delete', title: 'Demo',
      status: 'published', visibility: 'public',
    })

    await (deleteHandler as Handler)(adminEvent({ params: { id }, query: { deleteDemo: 'true' } }))

    const remaining = await db.query.contentItems.findFirst({
      where: and(eq(contentItems.siteId, SITE), eq(contentItems.slug, 'demo-page-to-delete')),
    })
    expect(remaining).toBeUndefined()
  })
})

describe('POST /api/v1/themes/:id/preview', () => {
  it('returns a preview URL containing the theme id', async () => {
    const id = await seedTheme()
    const result = await (previewHandler as Handler)(adminEvent({ params: { id } })) as { previewUrl: string }
    expect(result.previewUrl).toContain(`__theme_id=${id}`)
  })

  it('throws 404 for a theme on another site', async () => {
    const id = await seedTheme({ id: ulid(), siteId: OTHER_SITE })
    await expect(
      (previewHandler as Handler)(adminEvent({ params: { id } })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/v1/themes/:id/demo-import', () => {
  it('imports demo content and activates the theme', async () => {
    const id = await seedTheme({ isActive: false })
    getThemeDemoMock.mockResolvedValueOnce(JSON.stringify(MINIMAL_BACKUP))

    const result = await (demoImportHandler as Handler)(adminEvent({ params: { id }, body: {} })) as { success: boolean }
    expect(result.success).toBe(true)

    const db = getCurrentTestDb()
    const row = await db.query.themes.findFirst({ where: eq(themes.id, id) })
    expect(row?.isActive).toBe(true)
  })

  it('throws 404 when the theme has no demo content', async () => {
    const id = await seedTheme()
    getThemeDemoMock.mockResolvedValueOnce(null)

    await expect(
      (demoImportHandler as Handler)(adminEvent({ params: { id }, body: {} })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/v1/themes/reset', () => {
  it('deactivates all themes for the site', async () => {
    const themeA = await seedTheme({ isActive: true })
    const themeB = await seedTheme({ isActive: true })

    await (resetHandler as Handler)(adminEvent())

    const db = getCurrentTestDb()
    const rowA = await db.query.themes.findFirst({ where: eq(themes.id, themeA) })
    const rowB = await db.query.themes.findFirst({ where: eq(themes.id, themeB) })
    expect(rowA?.isActive).toBe(false)
    expect(rowB?.isActive).toBe(false)
  })

  it('throws 403 for editor (below admin)', async () => {
    await expect((resetHandler as Handler)(editorEvent())).rejects.toMatchObject({ statusCode: 403 })
  })
})
