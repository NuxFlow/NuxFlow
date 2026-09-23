/**
 * Integration tests for the AI page/site generation job queue — POST/GET
 * /api/v1/ai/generate, GET .../:jobId, POST .../:jobId/approve — wiring up the
 * previously-fully-migrated-but-completely-unused ai_generation_jobs table.
 *
 * All AI calls are mocked (no real network calls). Both site-generation.ts's plan call
 * and canvas-generation.ts's per-page block call go through the same mocked
 * generateObject — distinguished by call order, since the plan call always happens
 * before any page-generation call in this flow.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { aiGenerationJobs, contentItems } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import createJobHandler from '../../server/api/v1/ai/generate/index.post'
import listJobsHandler from '../../server/api/v1/ai/generate/index.get'
import getJobHandler from '../../server/api/v1/ai/generate/[jobId].get'
import approveJobHandler from '../../server/api/v1/ai/generate/[jobId]/approve.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const { mockGetAiSdkModel, mockGenerateObject } = vi.hoisted(() => ({
  mockGetAiSdkModel: vi.fn(),
  mockGenerateObject: vi.fn(),
}))

vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: mockGetAiSdkModel,
  requireAiSdkModel: async (...args: unknown[]) => {
    const model = await mockGetAiSdkModel(...args)
    if (!model) {
      const err = new Error('No AI provider configured.') as Error & { statusCode: number }
      err.statusCode = 503
      throw err
    }
    return model
  },
  callAiOrThrow: async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      const e = new Error(err instanceof Error ? err.message : String(err)) as Error & { statusCode: number }
      e.statusCode = 502
      throw e
    }
  },
}))

vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))

const SITE = 'site-ai-gen-01'
let editorId: string
let authorId: string
let pageTypeId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 2000, intervalMs = 10): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`)
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'ai-gen.localhost' })
  pageTypeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
  editorId = await seedUser(db, { email: 'editor@ai-gen.test' })
  await seedRole(db, editorId, SITE, 'editor')
  authorId = await seedUser(db, { email: 'author@ai-gen.test' })
  await seedRole(db, authorId, SITE, 'author')
})

afterAll(teardownTestDb)

function editorEvent(body: unknown, params: Record<string, string> = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@ai-gen.test' } },
    body,
    params,
  }) as unknown as H3Event
}

function authorEvent(body: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@ai-gen.test' } },
    body,
  }) as unknown as H3Event
}

const SAMPLE_BLOCK_RESPONSE = {
  object: { blocks: [{ type: 'canvas-hero', props: { headline: 'Welcome' } }] },
}

describe('POST /api/v1/ai/generate', () => {
  it('returns 503 without creating a job when no AI provider is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)
    const db = getCurrentTestDb()
    const before = await db.query.aiGenerationJobs.findMany({ where: eq(aiGenerationJobs.siteId, SITE) })

    await expect(
      (createJobHandler as HandlerFn)(editorEvent({ prompt: 'A landing page for a coffee shop', type: 'page' })),
    ).rejects.toMatchObject({ statusCode: 503 })

    const after = await db.query.aiGenerationJobs.findMany({ where: eq(aiGenerationJobs.siteId, SITE) })
    expect(after.length).toBe(before.length)
  })

  it('rejects an author-role caller — generation requires editor or above', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    await expect(
      (createJobHandler as HandlerFn)(authorEvent({ prompt: 'A landing page for a bakery', type: 'page' })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('type=page: creates a job that completes with one draft content item', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce(SAMPLE_BLOCK_RESPONSE)
    const db = getCurrentTestDb()

    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A landing page for a coffee shop in Bristol', type: 'page' }),
    ) as { jobId: string }
    expect(created.jobId).toBeTruthy()

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return job?.status === 'complete'
    })

    const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    expect(job?.type).toBe('page')
    expect(job?.generatedCount).toBe(1)
    expect(job?.totalCount).toBe(1)
    expect(job?.contentItemIds).toHaveLength(1)

    const itemId = job!.contentItemIds![0]!
    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(item?.status).toBe('draft')
    expect(item?.siteId).toBe(SITE)
    expect((item?.content as { blocks: unknown[] }).blocks).toHaveLength(1)
  })

  it('type=page: marks the job failed (not silently lost) when generation throws', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockRejectedValueOnce(new Error('Provider overloaded'))
    const db = getCurrentTestDb()

    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A landing page that will fail to generate', type: 'page' }),
    ) as { jobId: string }

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return job?.status === 'failed'
    })

    const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    expect(job?.error).toContain('Provider overloaded')
  })

  it('type=site: creates a job in "planning" status with the plan populated once ready', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        pages: [
          { title: 'Home', slug: 'home', description: 'The homepage with a hero and features.' },
          { title: 'About', slug: 'about', description: 'About the company.' },
        ],
      },
    })
    const db = getCurrentTestDb()

    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A small site for a design studio', type: 'site' }),
    ) as { jobId: string }

    const jobRightAfterCreate = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    expect(jobRightAfterCreate?.status).toBe('planning')

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return !!job?.plan?.length
    })

    const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    expect(job?.status).toBe('planning')
    expect(job?.plan).toHaveLength(2)
    expect(job?.totalCount).toBe(2)
    expect(job?.plan?.[0]).toMatchObject({ title: 'Home', slug: 'home' })
  })
})

describe('GET /api/v1/ai/generate/:jobId', () => {
  it('returns the job for this site', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce(SAMPLE_BLOCK_RESPONSE)
    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A page to fetch back via GET', type: 'page' }),
    ) as { jobId: string }

    const result = await (getJobHandler as HandlerFn)(editorEvent(undefined, { jobId: created.jobId })) as { id: string }
    expect(result.id).toBe(created.jobId)
  })

  it('throws 404 for a job belonging to another site', async () => {
    const db = getCurrentTestDb()
    const otherSite = 'site-ai-gen-other'
    await seedSite(db, { id: otherSite, domain: 'ai-gen-other.localhost' })
    const otherEditor = await seedUser(db, { email: 'editor@ai-gen-other.test' })
    await seedRole(db, otherEditor, otherSite, 'editor')

    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce(SAMPLE_BLOCK_RESPONSE)
    const otherEvent = createMockEvent({
      siteId: otherSite,
      session: { user: { id: otherEditor, name: 'Other Editor', email: 'editor@ai-gen-other.test' } },
      body: { prompt: 'A page on a different site', type: 'page' },
    }) as unknown as H3Event
    const created = await (createJobHandler as HandlerFn)(otherEvent) as { jobId: string }

    await expect(
      (getJobHandler as HandlerFn)(editorEvent(undefined, { jobId: created.jobId })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('GET /api/v1/ai/generate (history list)', () => {
  it('lists jobs for the current site only, newest first', async () => {
    const result = await (listJobsHandler as HandlerFn)(editorEvent(undefined)) as { jobs: { siteId: string }[] }
    expect(result.jobs.length).toBeGreaterThan(0)
    expect(result.jobs.every(j => j.siteId === SITE)).toBe(true)
  })
})

describe('POST /api/v1/ai/generate/:jobId/approve', () => {
  it('generates every planned page as a draft, tracking progress incrementally', async () => {
    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        pages: [
          { title: 'Home', slug: 'approve-home', description: 'Homepage.' },
          { title: 'Contact', slug: 'approve-contact', description: 'Contact page.' },
        ],
      },
    })
    const db = getCurrentTestDb()

    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A two-page site for a plumber', type: 'site' }),
    ) as { jobId: string }

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return !!job?.plan?.length
    })

    // Each planned page triggers its own generateCanvasBlocks() call during approval.
    mockGenerateObject.mockResolvedValueOnce({ object: { blocks: [{ type: 'canvas-hero', props: { headline: 'Home' } }] } })
    mockGenerateObject.mockResolvedValueOnce({ object: { blocks: [{ type: 'canvas-text', props: { content: '<p>Contact us</p>' } }] } })

    const approveResult = await (approveJobHandler as HandlerFn)(editorEvent(undefined, { jobId: created.jobId })) as { status: string }
    expect(approveResult.status).toBe('generating')

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return job?.status === 'complete'
    })

    const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    expect(job?.generatedCount).toBe(2)
    expect(job?.contentItemIds).toHaveLength(2)

    const items = await db.query.contentItems.findMany({ where: eq(contentItems.siteId, SITE) })
    expect(items.some(i => i.slug === 'approve-home')).toBe(true)
    expect(items.some(i => i.slug === 'approve-contact')).toBe(true)
  })

  it('auto-dedupes a planned slug that already exists on this site rather than colliding with it', async () => {
    const db = getCurrentTestDb()
    const existingId = await seedContentItem(db, SITE, pageTypeId, {
      slug: 'dedupe-target',
      title: 'Existing page',
      status: 'published',
    })

    mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce({
      object: { pages: [{ title: 'New Page', slug: 'dedupe-target', description: 'Collides with an existing slug.' }] },
    })

    const created = await (createJobHandler as HandlerFn)(
      editorEvent({ prompt: 'A page whose planned slug already exists', type: 'site' }),
    ) as { jobId: string }

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return !!job?.plan?.length
    })

    mockGenerateObject.mockResolvedValueOnce(SAMPLE_BLOCK_RESPONSE)
    await (approveJobHandler as HandlerFn)(editorEvent(undefined, { jobId: created.jobId }))

    await waitFor(async () => {
      const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
      return job?.status === 'complete'
    })

    const job = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, created.jobId) })
    const newItemId = job!.contentItemIds![0]!
    const newItem = await db.query.contentItems.findFirst({ where: eq(contentItems.id, newItemId) })

    // The new item must NOT overwrite the existing one — it gets a deduped slug instead.
    expect(newItem?.slug).not.toBe('dedupe-target')
    expect(newItem?.slug).toMatch(/^dedupe-target-\d+$/)

    const existing = await db.query.contentItems.findFirst({ where: eq(contentItems.id, existingId) })
    expect(existing?.title).toBe('Existing page')
  })
})