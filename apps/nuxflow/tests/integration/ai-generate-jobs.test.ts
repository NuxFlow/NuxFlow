/**
 * Integration tests for the AI page/site generation jobs — POST/GET /api/v1/ai/generate,
 * GET .../:jobId, POST .../:jobId/{step,approve,regenerate}.
 *
 * Jobs are driven one unit of work per POST .../step (the plan, or one page) rather than
 * in a waitUntil() background task — Cloudflare cancels waitUntil work 30 s after the
 * response, which a multi-page job can't fit in. So every test here drives the job
 * explicitly with step calls and asserts on the result synchronously.
 *
 * All AI calls are mocked. The plan call and each page's block call go through the same
 * mocked generateObject, distinguished by call order.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { aiGenerationJobs, auditLogs, contentItems, taxonomies } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import createJobHandler from '../../server/api/v1/ai/generate/index.post'
import listJobsHandler from '../../server/api/v1/ai/generate/index.get'
import getJobHandler from '../../server/api/v1/ai/generate/[jobId].get'
import stepHandler from '../../server/api/v1/ai/generate/[jobId]/step.post'
import approveJobHandler from '../../server/api/v1/ai/generate/[jobId]/approve.post'
import regenerateHandler from '../../server/api/v1/ai/generate/[jobId]/regenerate.post'

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
  aiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  callAiOrThrow: async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    }
    catch (err) {
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

interface PlanPage { title: string; slug: string; description: string; contentItemId?: string; error?: string }
interface JobResponse {
  id: string
  type: 'page' | 'site'
  status: string
  plan: PlanPage[] | null
  generatedCount: number
  totalCount: number
  busy: boolean
  error: string | null
  items: Array<{ id: string; title: string; slug: string; status: string; content: { blocks: Array<{ type: string; props: Record<string, unknown> }> } }>
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

beforeEach(() => {
  mockGenerateObject.mockReset()
  mockGetAiSdkModel.mockReset()
  mockGetAiSdkModel.mockResolvedValue(Symbol('fake-model'))
})

function editorEvent(body: unknown, params: Record<string, string> = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@ai-gen.test' } },
    body,
    params,
  }) as unknown as H3Event
}

function authorEvent(body: unknown, params: Record<string, string> = {}) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: authorId, name: 'Author', email: 'author@ai-gen.test' } },
    body,
    params,
  }) as unknown as H3Event
}

const pageResponse = (title: string, slug: string, headline = title) => ({
  object: { title, slug, blocks: [{ type: 'canvas-hero', props: { headline }, children: [] }] },
})

async function createJob(body: Record<string, unknown>): Promise<JobResponse> {
  const res = await (createJobHandler as HandlerFn)(editorEvent(body)) as { jobId: string; job: JobResponse }
  return res.job
}

const step = (jobId: string) => (stepHandler as HandlerFn)(editorEvent(undefined, { jobId })) as Promise<JobResponse>
const approve = (jobId: string, body?: unknown) => (approveJobHandler as HandlerFn)(editorEvent(body ?? {}, { jobId })) as Promise<JobResponse>
const regenerate = (jobId: string, index: number) => (regenerateHandler as HandlerFn)(editorEvent({ index }, { jobId })) as Promise<JobResponse>

describe('POST /api/v1/ai/generate', () => {
  it('returns 503 without creating a job when no AI provider is configured', async () => {
    mockGetAiSdkModel.mockResolvedValue(null)
    const db = getCurrentTestDb()
    const before = await db.query.aiGenerationJobs.findMany({ where: eq(aiGenerationJobs.siteId, SITE) })

    await expect(
      (createJobHandler as HandlerFn)(editorEvent({ prompt: 'A landing page for a coffee shop', type: 'page' })),
    ).rejects.toMatchObject({ statusCode: 503 })

    const after = await db.query.aiGenerationJobs.findMany({ where: eq(aiGenerationJobs.siteId, SITE) })
    expect(after.length).toBe(before.length)
  })

  it('rejects an author-role caller — generation requires editor or above', async () => {
    await expect(
      (createJobHandler as HandlerFn)(authorEvent({ prompt: 'A landing page for a bakery', type: 'page' })),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates the job without calling the AI — work only happens in step calls', async () => {
    const job = await createJob({ prompt: 'A small site for a design studio', type: 'site', tone: 'playful' })
    expect(job.status).toBe('planning')
    expect(job.plan).toBeNull()
    expect(mockGenerateObject).not.toHaveBeenCalled()

    const row = await getCurrentTestDb().query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, job.id) })
    expect(row?.tone).toBe('playful')
  })
})

describe('single-page jobs', () => {
  it('one step generates the page as a draft, named by the model', async () => {
    const db = getCurrentTestDb()
    const job = await createJob({ prompt: 'A landing page for a coffee shop in Bristol', type: 'page' })
    expect(job.status).toBe('generating')
    expect(job.totalCount).toBe(1)

    mockGenerateObject.mockResolvedValueOnce(pageResponse('Bristol Beans', 'Bristol Beans!'))
    const done = await step(job.id)

    expect(done.status).toBe('complete')
    expect(done.generatedCount).toBe(1)
    expect(done.busy).toBe(false)
    expect(done.items).toHaveLength(1)
    const item = done.items[0]!
    expect(item).toMatchObject({ title: 'Bristol Beans', slug: 'bristol-beans', status: 'draft' })
    expect(item.content.blocks[0]!.props.headline).toBe('Bristol Beans')
    expect(done.plan![0]!.contentItemId).toBe(item.id)

    const [audit] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.resource, 'content_item'), eq(auditLogs.resourceId, item.id)))
    expect(audit?.action).toBe('create')
  })

  it('records a page failure on its plan entry rather than losing it, and finishes the job', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const job = await createJob({ prompt: 'A landing page that will fail to generate', type: 'page' })
    mockGenerateObject.mockRejectedValueOnce(new Error('Provider overloaded'))

    const done = await step(job.id)

    expect(done.status).toBe('complete')
    expect(done.items).toHaveLength(0)
    expect(done.plan![0]!.error).toContain('Provider overloaded')
    consoleErrorSpy.mockRestore()
  })
})

describe('whole-site jobs', () => {
  it('plan → edited approval → one page per step → complete', async () => {
    const job = await createJob({ prompt: 'A two-page site for Pipe Pros, a Leeds plumber', type: 'site' })

    mockGenerateObject.mockResolvedValueOnce({
      object: {
        pages: [
          { title: 'Home', slug: 'pipes-home', description: 'Homepage.' },
          { title: 'Contact', slug: 'pipes-contact', description: 'Contact page.' },
        ],
      },
    })
    const planned = await step(job.id)
    expect(planned.status).toBe('planning')
    expect(planned.plan).toHaveLength(2)

    // A plan awaiting approval has no work — stepping again calls no AI.
    await step(job.id)
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)

    // The editor drops Contact, adds Services and gives it a slug that clashes with Home's.
    const approved = await approve(job.id, {
      pages: [
        { title: 'Home', slug: 'pipes-home', description: 'Homepage with hero and services.' },
        { title: 'Services', slug: 'pipes-home', description: 'Every service we offer.' },
      ],
    })
    expect(approved.status).toBe('generating')
    expect(approved.plan!.map(p => p.slug)).toEqual(['pipes-home', 'pipes-home-2'])

    mockGenerateObject.mockResolvedValueOnce(pageResponse('ignored', 'ignored', 'Home hero'))
    const first = await step(job.id)
    expect(first.status).toBe('generating')
    expect(first.generatedCount).toBe(1)

    // Every page is generated with the whole-site brief and the site's page list.
    const [args] = mockGenerateObject.mock.calls.at(-1) as [{ prompt: string }]
    expect(args.prompt).toContain('Pipe Pros, a Leeds plumber')
    expect(args.prompt).toContain('/pipes-home-2 — Services')

    mockGenerateObject.mockResolvedValueOnce(pageResponse('ignored', 'ignored', 'Services hero'))
    const done = await step(job.id)
    expect(done.status).toBe('complete')
    expect(done.generatedCount).toBe(2)
    // A site job keeps the reviewed plan's titles/slugs, not the model's.
    expect(done.items.map(i => i.slug).sort()).toEqual(['pipes-home', 'pipes-home-2'])
    expect(done.items.find(i => i.slug === 'pipes-home')!.title).toBe('Home')
  })

  it('marks the job failed when planning fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const job = await createJob({ prompt: 'A site whose plan will fail', type: 'site' })
    mockGenerateObject.mockRejectedValueOnce(new Error('Model unavailable'))

    const failed = await step(job.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('Model unavailable')
    consoleErrorSpy.mockRestore()
  })

  it('never reuses an existing page\'s or a taxonomy\'s slug', async () => {
    const db = getCurrentTestDb()
    const existingId = await seedContentItem(db, SITE, pageTypeId, { slug: 'dedupe-target', title: 'Existing page', status: 'published' })
    await db.insert(taxonomies).values({ id: ulid(), siteId: SITE, slug: 'news', name: 'News' })

    const job = await createJob({ prompt: 'A site whose planned slugs already exist', type: 'site' })
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        pages: [
          { title: 'New Page', slug: 'dedupe-target', description: 'Collides with an existing page.' },
          { title: 'News', slug: 'news', description: 'Collides with a taxonomy.' },
        ],
      },
    })
    await step(job.id)
    await approve(job.id)
    mockGenerateObject.mockResolvedValueOnce(pageResponse('x', 'x'))
    await step(job.id)
    mockGenerateObject.mockResolvedValueOnce(pageResponse('x', 'x'))
    const done = await step(job.id)

    const slugs = done.items.map(i => i.slug)
    expect(slugs).toContain('dedupe-target-2')
    expect(slugs).toContain('news-page')
    const existing = await db.query.contentItems.findFirst({ where: eq(contentItems.id, existingId) })
    expect(existing?.title).toBe('Existing page')
  })
})

describe('the step lease', () => {
  it('a step while another request holds the lease does no work and reports busy', async () => {
    const db = getCurrentTestDb()
    const job = await createJob({ prompt: 'A page being generated in another tab', type: 'page' })
    await db.update(aiGenerationJobs)
      .set({ lockedUntil: new Date(Date.now() + 60_000).toISOString() })
      .where(eq(aiGenerationJobs.id, job.id))

    const res = await step(job.id)
    expect(res.busy).toBe(true)
    expect(res.status).toBe('generating')
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('an expired lease (a request that died) is taken over', async () => {
    const db = getCurrentTestDb()
    const job = await createJob({ prompt: 'A page whose first step died mid-call', type: 'page' })
    await db.update(aiGenerationJobs)
      .set({ lockedUntil: new Date(Date.now() - 1000).toISOString() })
      .where(eq(aiGenerationJobs.id, job.id))

    mockGenerateObject.mockResolvedValueOnce(pageResponse('Recovered', 'recovered'))
    const res = await step(job.id)
    expect(res.status).toBe('complete')

    const row = await db.query.aiGenerationJobs.findFirst({ where: eq(aiGenerationJobs.id, job.id) })
    expect(row?.lockedUntil).toBeNull()
  })

  it('404s for another site\'s job', async () => {
    const db = getCurrentTestDb()
    const otherSite = 'site-ai-gen-other'
    await seedSite(db, { id: otherSite, domain: 'ai-gen-other.localhost' })
    const otherJobId = ulid()
    await db.insert(aiGenerationJobs).values({ id: otherJobId, siteId: otherSite, userId: editorId, prompt: 'Another site', type: 'page', status: 'generating' })

    await expect(step(otherJobId)).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      (getJobHandler as HandlerFn)(editorEvent(undefined, { jobId: otherJobId })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/v1/ai/generate/:jobId/approve', () => {
  it('can only approve once', async () => {
    const job = await createJob({ prompt: 'A site approved twice by a double-click', type: 'site' })
    mockGenerateObject.mockResolvedValueOnce({ object: { pages: [{ title: 'Home', slug: 'twice-home', description: 'Homepage.' }] } })
    await step(job.id)

    await approve(job.id)
    await expect(approve(job.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('POST /api/v1/ai/generate/:jobId/regenerate', () => {
  async function completedPageJob(prompt: string) {
    const job = await createJob({ prompt, type: 'page' })
    mockGenerateObject.mockResolvedValueOnce(pageResponse('First take', 'first-take'))
    return step(job.id)
  }

  it('replaces a draft\'s content in place and bumps its version', async () => {
    const db = getCurrentTestDb()
    const done = await completedPageJob('A page to regenerate in place')
    const itemId = done.items[0]!.id
    const before = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })

    mockGenerateObject.mockResolvedValueOnce(pageResponse('Second take', 'second-take', 'Second headline'))
    const after = await regenerate(done.id, 0)

    expect(after.items).toHaveLength(1)
    expect(after.items[0]!.id).toBe(itemId)
    expect(after.items[0]!.content.blocks[0]!.props.headline).toBe('Second headline')
    const row = await db.query.contentItems.findFirst({ where: eq(contentItems.id, itemId) })
    expect(row!.version).toBe(before!.version + 1)
  })

  it('never overwrites a page that has since been published — it makes a fresh draft', async () => {
    const db = getCurrentTestDb()
    const done = await completedPageJob('A page published before being regenerated')
    const publishedId = done.items[0]!.id
    await db.update(contentItems).set({ status: 'published' }).where(eq(contentItems.id, publishedId))

    mockGenerateObject.mockResolvedValueOnce(pageResponse('Fresh draft', 'fresh-draft', 'New'))
    const after = await regenerate(done.id, 0)

    expect(after.plan![0]!.contentItemId).not.toBe(publishedId)
    const published = await db.query.contentItems.findFirst({ where: eq(contentItems.id, publishedId) })
    expect((published!.content as { blocks: Array<{ props: Record<string, unknown> }> }).blocks[0]!.props.headline).toBe('First take')
  })

  it('refuses while the job is still running', async () => {
    const job = await createJob({ prompt: 'A page not generated yet', type: 'page' })
    await expect(regenerate(job.id, 0)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('reading jobs', () => {
  it('lists this site\'s jobs only, newest first', async () => {
    const result = await (listJobsHandler as HandlerFn)(editorEvent(undefined)) as { jobs: { siteId: string; createdAt: string }[] }
    expect(result.jobs.length).toBeGreaterThan(0)
    expect(result.jobs.every(j => j.siteId === SITE)).toBe(true)
  })

  it('requires editor — prompts and generated drafts aren\'t for members/viewers', async () => {
    const job = await createJob({ prompt: 'A page an author tries to read', type: 'page' })
    await expect(
      (getJobHandler as HandlerFn)(authorEvent(undefined, { jobId: job.id })),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect((listJobsHandler as HandlerFn)(authorEvent(undefined))).rejects.toMatchObject({ statusCode: 403 })
  })
})
