/**
 * Integration tests for the three GEO/LLMO fields added to content items:
 *   canonicalUrl, focusKeyword, metaRobots
 *
 * Covers: PATCH persistence, GET retrieval, field clearing (null), and
 * that the public pages API exposes canonicalUrl and metaRobots.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import getHandler from '../../server/api/v1/content/[id].get'
import patchHandler from '../../server/api/v1/content/[id].patch'
import publicPageHandler from '../../server/api/public/pages/[slug].get'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// trackPageView uses an Analytics Engine binding that isn't available in tests
vi.mock('../../server/utils/analytics', () => ({
  trackPageView: vi.fn(),
}))

const SITE = 'site-content-seo-01'
let userId: string
let typeId: string
let itemId: string

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'content-seo.localhost' })
  userId = await seedUser(db, { email: 'author@content-seo.test' })
  await seedRole(db, userId, SITE, 'author')
  typeId = await seedContentType(db, SITE, { slug: 'page', name: 'Page', singularName: 'Page' })
  itemId = await seedContentItem(db, SITE, typeId, {
    slug: 'seo-test-page',
    title: 'SEO Test Page',
    status: 'published',
    visibility: 'public',
  })
})

afterAll(teardownTestDb)

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkPatchEvent(body: unknown, id = itemId) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Author', email: 'author@content-seo.test' } },
    body,
    params: { id },
  }) as unknown as H3Event
}

function mkGetEvent(id = itemId) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Author', email: 'author@content-seo.test' } },
    params: { id },
  }) as unknown as H3Event
}

function mkPublicEvent(slug: string) {
  return createMockEvent({ siteId: SITE, params: { slug } }) as unknown as H3Event
}

// ---------------------------------------------------------------------------
// canonicalUrl
// ---------------------------------------------------------------------------

describe('canonicalUrl field', () => {
  it('persists a canonical URL override via PATCH', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ canonicalUrl: 'https://example.com/custom-path' }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { canonicalUrl: string | null }
    expect(result.canonicalUrl).toBe('https://example.com/custom-path')
  })

  it('clears the canonical URL when set to null', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ canonicalUrl: 'https://example.com/will-be-cleared' }))
    await (patchHandler as HandlerFn)(mkPatchEvent({ canonicalUrl: null }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { canonicalUrl: string | null }
    expect(result.canonicalUrl).toBeNull()
  })

  it('is exposed by the public pages API', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ canonicalUrl: 'https://example.com/public-canonical' }))
    const result = await (publicPageHandler as HandlerFn)(mkPublicEvent('seo-test-page')) as { canonicalUrl: string | null }
    expect(result.canonicalUrl).toBe('https://example.com/public-canonical')
  })
})

// ---------------------------------------------------------------------------
// focusKeyword
// ---------------------------------------------------------------------------

describe('focusKeyword field', () => {
  it('persists a focus keyword via PATCH', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ focusKeyword: 'headless CMS' }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { focusKeyword: string | null }
    expect(result.focusKeyword).toBe('headless CMS')
  })

  it('clears the focus keyword when set to null', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ focusKeyword: 'to be removed' }))
    await (patchHandler as HandlerFn)(mkPatchEvent({ focusKeyword: null }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { focusKeyword: string | null }
    expect(result.focusKeyword).toBeNull()
  })

  it('is not exposed via the public pages API (internal editorial field)', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ focusKeyword: 'internal keyword' }))
    const result = await (publicPageHandler as HandlerFn)(mkPublicEvent('seo-test-page')) as Record<string, unknown>
    expect(result.focusKeyword).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// metaRobots
// ---------------------------------------------------------------------------

describe('metaRobots field', () => {
  it('persists a valid metaRobots value via PATCH', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: 'noindex,follow' }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { metaRobots: string | null }
    expect(result.metaRobots).toBe('noindex,follow')
  })

  it('accepts all valid enum values', async () => {
    const validValues = ['index,follow', 'noindex,follow', 'noindex,nofollow', 'index,nofollow'] as const
    for (const value of validValues) {
      await (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: value }))
      const result = await (getHandler as HandlerFn)(mkGetEvent()) as { metaRobots: string | null }
      expect(result.metaRobots).toBe(value)
    }
  })

  it('clears the metaRobots override when set to null', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: 'noindex,nofollow' }))
    await (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: null }))
    const result = await (getHandler as HandlerFn)(mkGetEvent()) as { metaRobots: string | null }
    expect(result.metaRobots).toBeNull()
  })

  it('rejects an invalid metaRobots value with a validation error', async () => {
    await expect(
      (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: 'noindex' })),
    ).rejects.toThrow()
  })

  it('is exposed by the public pages API', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent({ metaRobots: 'noindex,follow' }))
    const result = await (publicPageHandler as HandlerFn)(mkPublicEvent('seo-test-page')) as { metaRobots: string | null }
    expect(result.metaRobots).toBe('noindex,follow')
  })
})

// ---------------------------------------------------------------------------
// Combined: all three fields together
// ---------------------------------------------------------------------------

describe('all three GEO fields in a single PATCH', () => {
  let combinedItemId: string

  beforeAll(async () => {
    combinedItemId = await seedContentItem(getCurrentTestDb(), SITE, typeId, {
      slug: 'combined-seo-page',
      title: 'Combined SEO Page',
      status: 'published',
      visibility: 'public',
    })
  })

  it('persists all three SEO fields simultaneously', async () => {
    await (patchHandler as HandlerFn)(mkPatchEvent(
      {
        canonicalUrl: 'https://example.com/combined',
        focusKeyword: 'combined test',
        metaRobots: 'index,follow',
      },
      combinedItemId,
    ))

    const result = await (getHandler as HandlerFn)(mkGetEvent(combinedItemId)) as {
      canonicalUrl: string | null
      focusKeyword: string | null
      metaRobots: string | null
    }

    expect(result.canonicalUrl).toBe('https://example.com/combined')
    expect(result.focusKeyword).toBe('combined test')
    expect(result.metaRobots).toBe('index,follow')
  })
})
