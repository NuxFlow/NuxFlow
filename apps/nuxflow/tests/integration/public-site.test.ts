import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedSetting } from '../helpers/seed'
import handler from '../../server/api/public/site.get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-public-site-01'

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'publicsite.localhost', name: 'Audit Test Site' })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent() {
  return createMockEvent({ siteId: SITE }) as unknown as H3Event
}

interface SiteResponse {
  name: string
  domain: string
  showHeader: boolean
  showColorToggle: boolean
  faviconUrl: string | null
  logoUrl: string | null
}

describe('GET /api/public/site', () => {
  it('returns site name and domain', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as SiteResponse
    expect(result.name).toBe('Audit Test Site')
    expect(result.domain).toBe('publicsite.localhost')
  })

  it('returns showHeader: true by default (no setting)', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as SiteResponse
    expect(result.showHeader).toBe(true)
  })

  it('returns showColorToggle: true by default (no setting)', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as SiteResponse
    expect(result.showColorToggle).toBe(true)
  })

  it('returns logoUrl: null when appearance.logo_url is not set', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as SiteResponse
    expect(result.logoUrl).toBeNull()
  })

  it('returns faviconUrl: null when appearance.favicon_url is not set', async () => {
    const result = await (handler as HandlerFn)(mkEvent()) as SiteResponse
    expect(result.faviconUrl).toBeNull()
  })

  it('returns logoUrl when appearance.logo_url is set', async () => {
    const logoSite = `site-logo-${Date.now()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: logoSite, domain: `logo-${Date.now()}.localhost`, name: 'Logo Site' })
    await seedSetting(db, logoSite, 'appearance.logo_url', 'https://cdn.example.com/logo.svg')

    const event = createMockEvent({ siteId: logoSite }) as unknown as H3Event
    const result = await (handler as HandlerFn)(event) as SiteResponse
    expect(result.logoUrl).toBe('https://cdn.example.com/logo.svg')
  })

  it('returns faviconUrl when appearance.favicon_url is set', async () => {
    const faviconSite = `site-favicon-${Date.now()}`
    const db = getCurrentTestDb()
    await seedSite(db, { id: faviconSite, domain: `favicon-${Date.now()}.localhost`, name: 'Favicon Site' })
    await seedSetting(db, faviconSite, 'appearance.favicon_url', 'https://cdn.example.com/favicon.png')

    const event = createMockEvent({ siteId: faviconSite }) as unknown as H3Event
    const result = await (handler as HandlerFn)(event) as SiteResponse
    expect(result.faviconUrl).toBe('https://cdn.example.com/favicon.png')
  })

  it('throws 404 when siteId is missing from context', async () => {
    const event = createMockEvent({ siteId: undefined as unknown as string }) as unknown as H3Event
    ;(event as { context: { siteId: string | null } }).context.siteId = null
    await expect((handler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 for an unknown siteId', async () => {
    const event = createMockEvent({ siteId: 'nonexistent-site-id' }) as unknown as H3Event
    await expect((handler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 404 })
  })
})
