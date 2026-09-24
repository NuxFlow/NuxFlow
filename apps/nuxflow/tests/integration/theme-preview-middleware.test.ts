/**
 * Integration tests for server/middleware/06.theme-preview.ts.
 *
 * `?__theme_id=` used to be honored unconditionally — anyone who knew (or
 * guessed) a theme's id could force a preview of it on themselves with no
 * auth at all. These tests guard the fix: only an authenticated admin (or
 * higher) for the current site may set the preview cookie.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import themePreviewMiddleware from '../../server/middleware/06.theme-preview'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

type MiddlewareFn = (e: H3Event) => Promise<unknown>

describe('theme-preview middleware', () => {
  const previewSite = 'site-mw-theme-preview'
  let previewAdmin: string
  let previewEditor: string

  beforeAll(async () => {
    await initTestDb()
    const db = getCurrentTestDb()
    await seedSite(db, { id: previewSite, domain: 'preview.localhost', status: 'active', setupCompleted: true })
    previewAdmin = await seedUser(db, { email: 'preview-admin@middleware.test' })
    await seedRole(db, previewAdmin, previewSite, 'admin')
    previewEditor = await seedUser(db, { email: 'preview-editor@middleware.test' })
    await seedRole(db, previewEditor, previewSite, 'editor')
  })

  afterAll(teardownTestDb)

  function mkThemePreviewEvent(opts: { themeId?: string; userId?: string; cookies?: Record<string, string> } = {}) {
    return createMockEvent({
      siteId: previewSite,
      session: opts.userId ? { user: { id: opts.userId, name: 'Preview User', email: 'x@test.com' } } : null,
      query: opts.themeId ? { __theme_id: opts.themeId } : {},
      cookies: opts.cookies,
    }) as unknown as H3Event
  }

  it('sets the preview cookie when an admin requests a theme id', async () => {
    const event = mkThemePreviewEvent({ themeId: 'theme-123', userId: previewAdmin })
    await (themePreviewMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.themePreviewId).toBe('theme-123')
    expect((event as unknown as { _cookies: Record<string, string> })._cookies.__nuxflow_theme_preview).toBe('theme-123')
  })

  it('does NOT set the preview cookie for an unauthenticated visitor', async () => {
    const event = mkThemePreviewEvent({ themeId: 'theme-123' })
    await (themePreviewMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.themePreviewId).toBeUndefined()
    expect((event as unknown as { _cookies: Record<string, string> })._cookies.__nuxflow_theme_preview).toBeUndefined()
  })

  it('does NOT set the preview cookie for an authenticated non-admin (editor)', async () => {
    const event = mkThemePreviewEvent({ themeId: 'theme-123', userId: previewEditor })
    await (themePreviewMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.themePreviewId).toBeUndefined()
  })

  it('falls back to an existing preview cookie when no __theme_id is in the query', async () => {
    const event = mkThemePreviewEvent({ cookies: { __nuxflow_theme_preview: 'theme-from-cookie' } })
    await (themePreviewMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.themePreviewId).toBe('theme-from-cookie')
  })

  it('leaves themePreviewId unset when there is neither a query param nor a cookie', async () => {
    const event = mkThemePreviewEvent()
    await (themePreviewMiddleware as MiddlewareFn)(event)
    const ctx = (event as unknown as { context: Record<string, unknown> }).context
    expect(ctx.themePreviewId).toBeUndefined()
  })
})
