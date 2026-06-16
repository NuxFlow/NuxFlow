import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedSetting } from '../helpers/seed'
import { themes } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// putThemeCSS writes to Cloudflare KV — no-op in tests; spy to verify calls
const putThemeCSSMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/cf-env', () => ({
  putThemeCSS: (...args: unknown[]) => putThemeCSSMock(...args),
  getCfBindings: () => ({ kv: null }),
  getAnalyticsEngine: () => null,
}))

// ── Lazy handler imports (after mocks are in place) ───────────────────────────

const { default: getHandler } = await import('../../server/api/v1/themes/customizer.get')
const { default: postHandler } = await import('../../server/api/v1/themes/customizer.post')

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SITE = 'site-customizer-01'
let adminId: string
let editorId: string

const SAMPLE_VALUES = {
  colorMode: 'dark' as const,
  primaryColor: '#8b5cf6',
  linkColor: '#a78bfa',
  bgLight: '#fafafa',
  bgDark: '#0f172a',
  bodyFont: 'Inter',
  headingFont: 'same',
  fontSize: 'lg' as const,
  headingWeight: '700' as const,
  lineHeight: 'relaxed' as const,
  borderRadius: 'lg' as const,
  spacing: 'spacious' as const,
  contentWidth: 'wide' as const,
}

const SAMPLE_CSS = ':root { --nuxflow-primary: #8b5cf6; }'

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'customizer.localhost' })

  adminId = await seedUser(db, { email: 'admin@customizer.test', name: 'Admin' })
  editorId = await seedUser(db, { email: 'editor@customizer.test', name: 'Editor' })

  await seedRole(db, adminId, SITE, 'admin')
  await seedRole(db, editorId, SITE, 'editor')
})

afterAll(teardownTestDb)

type Handler = (e: H3Event) => Promise<unknown>

function adminEvent(body?: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: adminId, name: 'Admin', email: 'admin@customizer.test' } },
    body,
  }) as unknown as H3Event
}

function editorEvent(body?: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@customizer.test' } },
    body,
  }) as unknown as H3Event
}

function unauthEvent(body?: unknown) {
  return createMockEvent({ siteId: SITE, session: null, body }) as unknown as H3Event
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/themes/customizer
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/themes/customizer', () => {
  it('throws 403 when authenticated below admin', async () => {
    await expect(
      (getHandler as Handler)(editorEvent()),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 401 when unauthenticated', async () => {
    await expect(
      (getHandler as Handler)(unauthEvent()),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns defaults when no settings exist (first visit)', async () => {
    const freshSite = `site-cust-fresh-${ulid()}`
    const freshDb = getCurrentTestDb()
    await seedSite(freshDb, { id: freshSite, domain: `fresh-${ulid()}.localhost` })
    const freshAdmin = await seedUser(freshDb, { email: `admin-fresh-${ulid()}@test.com`, name: 'Fresh Admin' })
    await seedRole(freshDb, freshAdmin, freshSite, 'admin')

    const event = createMockEvent({
      siteId: freshSite,
      session: { user: { id: freshAdmin, name: 'Fresh Admin', email: `admin-fresh@test.com` } },
    }) as unknown as H3Event

    const result = await (getHandler as Handler)(event) as { values: Record<string, unknown>; customizerThemeId: null }

    expect(result.values.colorMode).toBe('auto')
    expect(result.values.primaryColor).toBe('#00dc82')
    expect(result.values.bodyFont).toBe('system')
    expect(result.values.borderRadius).toBe('md')
    expect(result.values.spacing).toBe('normal')
    expect(result.values.contentWidth).toBe('default')
    expect(result.customizerThemeId).toBeNull()
  })

  it('migrates from legacy 3-knob settings on first visit', async () => {
    const legacySite = `site-cust-legacy-${ulid()}`
    const legacyDb = getCurrentTestDb()
    await seedSite(legacyDb, { id: legacySite, domain: `legacy-${ulid()}.localhost` })
    const legacyAdmin = await seedUser(legacyDb, { email: `admin-legacy-${ulid()}@test.com`, name: 'Legacy Admin' })
    await seedRole(legacyDb, legacyAdmin, legacySite, 'admin')

    await seedSetting(legacyDb, legacySite, 'theme.dark_mode', 'dark')
    await seedSetting(legacyDb, legacySite, 'theme.primary_color', '#3b82f6')
    await seedSetting(legacyDb, legacySite, 'theme.font_sans', 'Poppins')

    const event = createMockEvent({
      siteId: legacySite,
      session: { user: { id: legacyAdmin, name: 'Legacy Admin', email: 'admin-legacy@test.com' } },
    }) as unknown as H3Event

    const result = await (getHandler as Handler)(event) as { values: Record<string, unknown>; customizerThemeId: null }

    expect(result.values.colorMode).toBe('dark')
    expect(result.values.primaryColor).toBe('#3b82f6')
    expect(result.values.bodyFont).toBe('Poppins')
    // Other fields should still be defaults
    expect(result.values.borderRadius).toBe('md')
    expect(result.customizerThemeId).toBeNull()
  })

  it('returns saved customizer values when they exist', async () => {
    const db = getCurrentTestDb()
    await seedSetting(db, SITE, 'theme.customizer_values', JSON.stringify(SAMPLE_VALUES))

    const result = await (getHandler as Handler)(adminEvent()) as { values: typeof SAMPLE_VALUES; customizerThemeId: null }

    expect(result.values.colorMode).toBe('dark')
    expect(result.values.primaryColor).toBe('#8b5cf6')
    expect(result.values.linkColor).toBe('#a78bfa')
    expect(result.values.bgLight).toBe('#fafafa')
    expect(result.values.bgDark).toBe('#0f172a')
    expect(result.values.bodyFont).toBe('Inter')
    expect(result.values.fontSize).toBe('lg')
    expect(result.values.borderRadius).toBe('lg')
    expect(result.values.spacing).toBe('spacious')
    expect(result.values.contentWidth).toBe('wide')
  })

  it('returns customizerThemeId when the stored theme exists in DB', async () => {
    const db = getCurrentTestDb()
    const themeId = ulid()

    await db.insert(themes).values({
      id: themeId,
      siteId: SITE,
      packageName: `@customizer/theme-${themeId}`,
      name: 'NuxFlow Customizer',
      version: '2024-01-01',
      isActive: true,
      hasCss: true,
    })
    await seedSetting(db, SITE, 'theme.customizer_theme_id', themeId)

    const result = await (getHandler as Handler)(adminEvent()) as { customizerThemeId: string }
    expect(result.customizerThemeId).toBe(themeId)
  })

  it('returns null customizerThemeId when stored theme no longer exists in DB', async () => {
    const orphanSite = `site-cust-orphan-${ulid()}`
    const orphanDb = getCurrentTestDb()
    await seedSite(orphanDb, { id: orphanSite, domain: `orphan-${ulid()}.localhost` })
    const orphanAdmin = await seedUser(orphanDb, { email: `admin-orphan-${ulid()}@test.com`, name: 'Orphan Admin' })
    await seedRole(orphanDb, orphanAdmin, orphanSite, 'admin')
    await seedSetting(orphanDb, orphanSite, 'theme.customizer_theme_id', 'nonexistent-theme-id')

    const event = createMockEvent({
      siteId: orphanSite,
      session: { user: { id: orphanAdmin, name: 'Orphan Admin', email: 'admin-orphan@test.com' } },
    }) as unknown as H3Event

    const result = await (getHandler as Handler)(event) as { customizerThemeId: null }
    expect(result.customizerThemeId).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/themes/customizer
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/themes/customizer', () => {
  beforeAll(() => putThemeCSSMock.mockClear())

  it('throws 401 when unauthenticated', async () => {
    await expect(
      (postHandler as Handler)(unauthEvent({ values: SAMPLE_VALUES, css: SAMPLE_CSS })),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 403 when authenticated below admin', async () => {
    await expect(
      (postHandler as Handler)(editorEvent({ values: SAMPLE_VALUES, css: SAMPLE_CSS })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('throws 400 when css is empty', async () => {
    await expect(
      (postHandler as Handler)(adminEvent({ values: SAMPLE_VALUES, css: '' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when css is whitespace only', async () => {
    await expect(
      (postHandler as Handler)(adminEvent({ values: SAMPLE_VALUES, css: '   ' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('creates a new CSS theme on first save and returns its ID', async () => {
    const newSite = `site-cust-post-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: newSite, domain: `post-${ulid()}.localhost` })
    const newAdmin = await seedUser(db, { email: `admin-post-${ulid()}@test.com`, name: 'Post Admin' })
    await seedRole(db, newAdmin, newSite, 'admin')

    const event = createMockEvent({
      siteId: newSite,
      session: { user: { id: newAdmin, name: 'Post Admin', email: 'admin-post@test.com' } },
      body: { values: SAMPLE_VALUES, css: SAMPLE_CSS },
    }) as unknown as H3Event

    const result = await (postHandler as Handler)(event) as { success: boolean; themeId: string }

    expect(result.success).toBe(true)
    expect(typeof result.themeId).toBe('string')
    expect(result.themeId.length).toBeGreaterThan(0)

    // Theme should be in DB, active, and hasCss
    const theme = await db.query.themes.findFirst({
      where: and(eq(themes.id, result.themeId), eq(themes.siteId, newSite)),
    })
    expect(theme).toBeDefined()
    expect(theme!.name).toBe('NuxFlow Customizer')
    expect(theme!.hasCss).toBe(true)
    expect(theme!.isActive).toBe(true)

    // putThemeCSS should have been called with the CSS
    expect(putThemeCSSMock).toHaveBeenCalledWith(expect.anything(), newSite, result.themeId, SAMPLE_CSS)
  })

  it('persists appearance settings alongside customizer values', async () => {
    const settingsSite = `site-cust-settings-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: settingsSite, domain: `settings-${ulid()}.localhost` })
    const settingsAdmin = await seedUser(db, { email: `admin-settings-${ulid()}@test.com`, name: 'Settings Admin' })
    await seedRole(db, settingsAdmin, settingsSite, 'admin')

    const event = createMockEvent({
      siteId: settingsSite,
      session: { user: { id: settingsAdmin, name: 'Settings Admin', email: 'admin-settings@test.com' } },
      body: {
        values: { ...SAMPLE_VALUES, colorMode: 'light', primaryColor: '#ef4444', bodyFont: 'Poppins' },
        css: SAMPLE_CSS,
      },
    }) as unknown as H3Event

    await (postHandler as Handler)(event)

    // Read back the individual appearance settings that should have been saved
    const { resolveSetting } = await import('../../server/utils/settings')
    const darkMode = await resolveSetting(event, 'theme.dark_mode')
    const primaryColor = await resolveSetting(event, 'theme.primary_color')
    const fontSans = await resolveSetting(event, 'theme.font_sans')
    const customizerValues = await resolveSetting(event, 'theme.customizer_values')

    expect(darkMode).toBe('light')
    expect(primaryColor).toBe('#ef4444')
    expect(fontSans).toBe('Poppins')
    expect(JSON.parse(customizerValues as string).colorMode).toBe('light')
  })

  it('reuses the existing customizer theme on subsequent saves', async () => {
    const reusesSite = `site-cust-reuse-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: reusesSite, domain: `reuse-${ulid()}.localhost` })
    const reusesAdmin = await seedUser(db, { email: `admin-reuse-${ulid()}@test.com`, name: 'Reuse Admin' })
    await seedRole(db, reusesAdmin, reusesSite, 'admin')

    const event = createMockEvent({
      siteId: reusesSite,
      session: { user: { id: reusesAdmin, name: 'Reuse Admin', email: 'admin-reuse@test.com' } },
      body: { values: SAMPLE_VALUES, css: SAMPLE_CSS },
    }) as unknown as H3Event

    const first = await (postHandler as Handler)(event) as { themeId: string }

    // Second save
    const event2 = createMockEvent({
      siteId: reusesSite,
      session: { user: { id: reusesAdmin, name: 'Reuse Admin', email: 'admin-reuse@test.com' } },
      body: { values: { ...SAMPLE_VALUES, primaryColor: '#06b6d4' }, css: ':root{--nuxflow-primary:#06b6d4}' },
    }) as unknown as H3Event

    const second = await (postHandler as Handler)(event2) as { themeId: string }

    // Same theme ID should be reused — no new theme created
    expect(second.themeId).toBe(first.themeId)

    // Only one NuxFlow Customizer theme should exist for this site
    const allThemes = await db.query.themes.findMany({
      where: eq(themes.siteId, reusesSite),
    })
    expect(allThemes.length).toBe(1)
    expect(allThemes[0]!.name).toBe('NuxFlow Customizer')
  })

  it('deactivates all other themes when activating the customizer theme', async () => {
    const deactivateSite = `site-cust-deactivate-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: deactivateSite, domain: `deactivate-${ulid()}.localhost` })
    const deactivateAdmin = await seedUser(db, { email: `admin-deactivate-${ulid()}@test.com`, name: 'Deactivate Admin' })
    await seedRole(db, deactivateAdmin, deactivateSite, 'admin')

    // Insert a pre-existing active bundled theme
    const bundledThemeId = ulid()
    await db.insert(themes).values({
      id: bundledThemeId,
      siteId: deactivateSite,
      packageName: '@nuxflow/theme-default',
      name: 'Default Theme',
      version: '1.0.0',
      isActive: true,
      hasCss: false,
    })

    const event = createMockEvent({
      siteId: deactivateSite,
      session: { user: { id: deactivateAdmin, name: 'Deactivate Admin', email: 'admin-deactivate@test.com' } },
      body: { values: SAMPLE_VALUES, css: SAMPLE_CSS },
    }) as unknown as H3Event

    const result = await (postHandler as Handler)(event) as { themeId: string }

    const bundled = await db.query.themes.findFirst({
      where: and(eq(themes.id, bundledThemeId), eq(themes.siteId, deactivateSite)),
    })
    const customizer = await db.query.themes.findFirst({
      where: and(eq(themes.id, result.themeId), eq(themes.siteId, deactivateSite)),
    })

    expect(bundled!.isActive).toBe(false)
    expect(customizer!.isActive).toBe(true)
  })

  it('writes an audit log entry on successful save', async () => {
    const auditSite = `site-cust-audit-${ulid()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: auditSite, domain: `audit-${ulid()}.localhost` })
    const auditAdmin = await seedUser(db, { email: `admin-audit-${ulid()}@test.com`, name: 'Audit Admin' })
    await seedRole(db, auditAdmin, auditSite, 'admin')

    const event = createMockEvent({
      siteId: auditSite,
      session: { user: { id: auditAdmin, name: 'Audit Admin', email: 'admin-audit@test.com' } },
      body: { values: SAMPLE_VALUES, css: SAMPLE_CSS },
    }) as unknown as H3Event

    await (postHandler as Handler)(event)

    const { auditLogs } = await import('@nuxflow/db/schema')
    const log = await db.query.auditLogs.findFirst({
      where: and(
        eq(auditLogs.siteId, auditSite),
        eq(auditLogs.userId, auditAdmin),
        eq(auditLogs.resource, 'theme'),
      ),
    })

    expect(log).toBeDefined()
    expect(log!.action).toBe('update')
  })
})
