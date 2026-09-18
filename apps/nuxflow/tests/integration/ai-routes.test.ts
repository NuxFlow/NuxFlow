/**
 * Integration tests for AI routes.
 *
 * External AI provider calls are fully mocked; the real test DB is used
 * only for routes that query it (alt-text looks up the media row).
 *
 * All AI routes go through the same getAiSdkModel + generateText/generateObject
 * (Vercel AI SDK) path — there is no separate hand-rolled provider abstraction.
 *
 * Routes covered:
 *   POST /api/v1/ai/seo-suggest      — uses getAiSdkModel + generateText
 *   POST /api/v1/ai/alt-text         — uses getAiSdkModel + generateText + media DB lookup
 *   POST /api/v1/ai/generate-content — uses getAiSdkModel + generateText
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq, and } from 'drizzle-orm'
import { media, auditLogs } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedMedia } from '../helpers/seed'
import seoSuggestHandler from '../../server/api/v1/ai/seo-suggest.post'
import altTextHandler from '../../server/api/v1/ai/alt-text.post'
import improveHandler from '../../server/api/v1/ai/improve.post'
import bulkAltTextHandler from '../../server/api/v1/ai/bulk-alt-text.post'
import generateContentHandler from '../../server/api/v1/ai/generate-content.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

// Hoist mock functions so vi.mock factory closures can capture them
const { mockGetAiSdkModel, mockGenerateText, mockGenerateObject, mockLoadImageBytesForAi } = vi.hoisted(() => ({
  mockGetAiSdkModel: vi.fn(),
  mockGenerateText: vi.fn(),
  // improve/seo-suggest now use generateObject (schema-enforced) instead of generateText +
  // manual JSON.parse — same pattern grammar.post.ts/generate-canvas.post.ts already used.
  mockGenerateObject: vi.fn(),
  // alt-text/bulk-alt-text now fetch the actual image bytes before calling generateText —
  // mocked here so tests never make a real network call to a media item's (fake) URL.
  mockLoadImageBytesForAi: vi.fn(),
}))

vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: mockGetAiSdkModel,
  requireAiSdkModel: async (...args: unknown[]) => {
    const model = await mockGetAiSdkModel(...args)
    if (!model) {
      const err = new Error('No AI provider configured. Add an API key in Settings → AI.') as Error & { statusCode: number }
      err.statusCode = 503
      throw err
    }
    return model
  },
  aiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  callAiOrThrow: async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      const e = new Error(err instanceof Error ? err.message : String(err)) as Error & { statusCode: number }
      e.statusCode = 502
      throw e
    }
  },
  loadImageBytesForAi: mockLoadImageBytesForAi,
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
  generateObject: mockGenerateObject,
}))

const SITE = 'site-ai-01'
let userId: string
let editorId: string
let mediaId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

// bulk-alt-text.post.ts now always processes via the shared waitUntil() helper
// (server/utils/cf-env.ts), which is fire-and-forget in every environment (there's no
// ctx.waitUntil in these mock events, so it falls into `void promise` rather than being
// awaited by the handler) — matching real Cloudflare behavior, where the response must
// return before the background job is guaranteed to finish. The handler's own promise
// resolves in the background regardless, so poll for the expected side effect instead of
// asserting on the handler's return value.
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

  await seedSite(db, { id: SITE, domain: 'ai.localhost' })
  userId = await seedUser(db, { email: 'author@ai.test' })
  await seedRole(db, userId, SITE, 'author')
  editorId = await seedUser(db, { email: 'editor@ai.test' })
  await seedRole(db, editorId, SITE, 'editor')
  mediaId = await seedMedia(db, SITE, {
    originalName: 'hero-photo.jpg',
    mimeType: 'image/jpeg',
    url: 'https://example.com/hero-photo.jpg',
  })
})

afterAll(teardownTestDb)

function mkEvent(body: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Author', email: 'author@ai.test' } },
    body,
  }) as unknown as H3Event
}

function mkEditorEvent(body: unknown) {
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: editorId, name: 'Editor', email: 'editor@ai.test' } },
    body,
  }) as unknown as H3Event
}

// ---------------------------------------------------------------------------
// POST /api/v1/ai/seo-suggest
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/seo-suggest', () => {
  it('returns 503 when no AI model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (seoSuggestHandler as HandlerFn)(mkEditorEvent({ title: 'My Article' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns seoTitle and seoDescription from the schema-validated AI response', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateObject.mockResolvedValueOnce({
      object: { title: 'AI Generated Title', description: 'AI Generated Description' },
    })

    const result = await (seoSuggestHandler as HandlerFn)(
      mkEditorEvent({ title: 'My Article', body: 'Some content about dogs.' }),
    ) as { seoTitle: string; seoDescription: string }

    expect(result.seoTitle).toBe('AI Generated Title')
    expect(result.seoDescription).toBe('AI Generated Description')
  })

  // generateObject enforces the schema at the provider-call level (with the AI SDK's own
  // internal retry/repair), so a response that can't be coerced into shape is a genuine
  // provider-call failure now, not a "parse what we got" fallback — it surfaces as the same
  // 502 path as any other AI SDK error, covered by the test below.
  it('returns 502 when the AI SDK throws', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateObject.mockRejectedValueOnce(new Error('Provider network error'))

    await expect(
      (seoSuggestHandler as HandlerFn)(mkEditorEvent({ title: 'Error Test' })),
    ).rejects.toMatchObject({ statusCode: 502 })
  })

  it('returns a validation error when title is missing', async () => {
    await expect(
      (seoSuggestHandler as HandlerFn)(mkEditorEvent({ body: 'some content without a title' })),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/alt-text
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/alt-text', () => {
  it('returns 503 when no AI model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (altTextHandler as HandlerFn)(mkEditorEvent({ mediaId })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns 404 when the media item does not exist', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))

    await expect(
      (altTextHandler as HandlerFn)(mkEditorEvent({ mediaId: 'nonexistent-media-id-00000' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns trimmed alt text from the AI SDK', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockLoadImageBytesForAi.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' })
    mockGenerateText.mockResolvedValueOnce({ text: '  A cheerful person smiling at the camera  ' })

    const result = await (altTextHandler as HandlerFn)(mkEditorEvent({ mediaId })) as { altText: string }

    expect(result.altText).toBe('A cheerful person smiling at the camera')
  })

  it('sends the fetched image bytes alongside a filename-context prompt', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    const fakeImage = { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' }
    mockLoadImageBytesForAi.mockResolvedValueOnce(fakeImage)
    mockGenerateText.mockResolvedValueOnce({ text: 'Alt text result' })

    await (altTextHandler as HandlerFn)(mkEditorEvent({ mediaId }))

    // The model must actually receive the image, not just a filename-only text prompt —
    // this is the exact "looks done but doesn't look at the image" gap being fixed.
    expect(mockLoadImageBytesForAi).toHaveBeenCalledWith('https://example.com/hero-photo.jpg', 'image/jpeg')
    const [callArgs] = mockGenerateText.mock.calls.at(-1) as [Record<string, unknown>]
    const messages = callArgs.messages as Array<{ content: Array<{ type: string; text?: string; image?: unknown }> }>
    const textPart = messages[0]!.content.find(p => p.type === 'text')
    const imagePart = messages[0]!.content.find(p => p.type === 'image')
    expect(textPart?.text).toContain('hero-photo.jpg')
    expect(imagePart?.image).toBe(fakeImage.data)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/improve
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/improve', () => {
  it('returns 503 when no AI model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (improveHandler as HandlerFn)(mkEditorEvent({ text: 'Some text', instruction: 'improve' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns the schema-validated array of alternatives', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateObject.mockResolvedValueOnce({ object: { alternatives: ['Alt 1', 'Alt 2', 'Alt 3'] } })

    const result = await (improveHandler as HandlerFn)(
      mkEditorEvent({ text: 'Some text', instruction: 'shorten' }),
    ) as { alternatives: string[] }

    expect(result.alternatives).toEqual(['Alt 1', 'Alt 2', 'Alt 3'])
  })

  it('returns 502 when the AI SDK throws', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateObject.mockRejectedValueOnce(new Error('Rate limited'))

    await expect(
      (improveHandler as HandlerFn)(mkEditorEvent({ text: 'Some text' })),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/bulk-alt-text
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/bulk-alt-text', () => {
  it('returns 503 when no AI model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (bulkAltTextHandler as HandlerFn)(mkEditorEvent({})),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('processes only the requested image, skipping non-image media, and writes one audit log row for the batch', async () => {
    const db = getCurrentTestDb()
    const docId = await seedMedia(db, SITE, { originalName: 'brochure.pdf', mimeType: 'application/pdf' })

    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockLoadImageBytesForAi.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' })
    mockGenerateText.mockResolvedValueOnce({ text: 'Generated alt text' })

    const result = await (bulkAltTextHandler as HandlerFn)(
      mkEditorEvent({ mediaIds: [mediaId, docId] }),
    ) as { processing: boolean; total: number; mediaIds: string[]; capped: boolean }

    // The route now always fires the background job via the shared waitUntil() helper
    // instead of awaiting it inline, so the response reports it's processing rather than
    // returning synchronous processed/skipped counts.
    expect(result.processing).toBe(true)
    expect(result.total).toBe(1)
    expect(result.mediaIds).toEqual([mediaId])
    expect(result.capped).toBe(false)

    await waitFor(async () => {
      const updated = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
      return updated?.altText === 'Generated alt text'
    })

    const [logEntry] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.resource, 'media'), eq(auditLogs.resourceId, 'bulk-alt-text')))
    expect(logEntry).toBeDefined()
    expect(logEntry.action).toBe('update')
    expect(logEntry.after).toMatchObject({ siteId: SITE, processed: 1, skipped: 0, total: 1 })
  })

  it('logs the error and counts a failure as skipped rather than silently dropping it', async () => {
    const db = getCurrentTestDb()
    const failId = await seedMedia(db, SITE, { originalName: 'will-fail.jpg', mimeType: 'image/jpeg' })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockLoadImageBytesForAi.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' })
    mockGenerateText.mockRejectedValueOnce(new Error('Provider rate limited'))

    const result = await (bulkAltTextHandler as HandlerFn)(
      mkEditorEvent({ mediaIds: [failId] }),
    ) as { processing: boolean; total: number }
    expect(result.processing).toBe(true)

    await waitFor(async () => {
      const [logEntry] = await db.select().from(auditLogs)
        .where(and(eq(auditLogs.resource, 'media'), eq(auditLogs.resourceId, 'bulk-alt-text'), eq(auditLogs.userId, editorId)))
        .orderBy(auditLogs.createdAt)
      return !!logEntry
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(failId),
      expect.any(Error),
    )
    consoleErrorSpy.mockRestore()
  })

  it('caps the number of images processed per invocation and reports how many remain', async () => {
    const db = getCurrentTestDb()
    // MAX_IMAGES_PER_RUN is 50 — seed one past the cap using the "process all untagged
    // images" path (no explicit mediaIds) so the cap logic (not the mediaIds filter) is
    // what's under test.
    const capSite = 'site-ai-cap-01'
    await seedSite(db, { id: capSite, domain: 'ai-cap.localhost' })
    const capEditorId = await seedUser(db, { email: 'editor@ai-cap.test' })
    await seedRole(db, capEditorId, capSite, 'editor')

    const ids: string[] = []
    for (let i = 0; i < 51; i++) {
      ids.push(await seedMedia(db, capSite, { originalName: `cap-${i}.jpg`, mimeType: 'image/jpeg' }))
    }

    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockLoadImageBytesForAi.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' })
    mockGenerateText.mockResolvedValue({ text: 'Generated alt text' })

    const event = createMockEvent({
      siteId: capSite,
      session: { user: { id: capEditorId, name: 'Cap Editor', email: 'editor@ai-cap.test' } },
      body: {},
    }) as unknown as H3Event

    const result = await (bulkAltTextHandler as HandlerFn)(event) as {
      processing: boolean; total: number; capped: boolean; remaining: number
    }

    expect(result.total).toBe(50)
    expect(result.capped).toBe(true)
    expect(result.remaining).toBe(1)

    await waitFor(async () => {
      const rows = await db.query.media.findMany({ where: eq(media.siteId, capSite) })
      return rows.filter(r => r.altText === 'Generated alt text').length === 50
    })

    // Exactly one of the 51 seeded images should have been left untouched by the capped run.
    const rows = await db.query.media.findMany({ where: eq(media.siteId, capSite) })
    expect(rows.filter(r => !r.altText).length).toBe(1)
    expect(ids.length).toBe(51)
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/generate-content
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/generate-content', () => {
  it('returns 503 when no AI SDK model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (generateContentHandler as HandlerFn)(
        mkEditorEvent({ description: 'Write about sustainable travel', tone: 'professional', format: 'prose' }),
      ),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns trimmed HTML from the AI SDK generateText call', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({ text: '  <p>Sustainable travel matters.</p>  ' })

    const result = await (generateContentHandler as HandlerFn)(
      mkEditorEvent({ description: 'Write about sustainable travel', tone: 'professional', format: 'prose' }),
    ) as { html: string }

    expect(result.html).toBe('<p>Sustainable travel matters.</p>')
  })

  it('passes the model and system prompt to generateText', async () => {
    const fakeModel = Symbol('fake-model-2')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({ text: '<p>Content</p>' })

    await (generateContentHandler as HandlerFn)(
      mkEditorEvent({ description: 'Write something', tone: 'casual', format: 'listicle' }),
    )

    const [callArgs] = mockGenerateText.mock.calls.at(-1) as [Record<string, unknown>]
    expect(callArgs.model).toBe(fakeModel)
    expect(typeof callArgs.system).toBe('string')
    expect((callArgs.system as string).length).toBeGreaterThan(0)
  })

  it('returns a validation error when description is too short', async () => {
    await expect(
      (generateContentHandler as HandlerFn)(mkEditorEvent({ description: 'Hi' })),
    ).rejects.toThrow()
  })

  it('returns 502 when the AI SDK throws', async () => {
    const fakeModel = Symbol('fake-model-3')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockRejectedValueOnce(new Error('Rate limit exceeded'))

    await expect(
      (generateContentHandler as HandlerFn)(
        mkEditorEvent({ description: 'Write about something interesting', tone: 'friendly', format: 'howto' }),
      ),
    ).rejects.toMatchObject({ statusCode: 502 })
  })

  // AI generation is metered, provider-billed authoring tooling — same baseline as
  // bulk-alt-text/generate-image (both already require 'editor'). A bare 'author' role
  // (this file's `mkEvent`) must be rejected, not silently treated as sufficient the way
  // a plain requireAuth() check would.
  it('rejects an author-role caller — AI generation requires editor or above', async () => {
    await expect(
      (generateContentHandler as HandlerFn)(
        mkEvent({ description: 'Write about something interesting', tone: 'friendly', format: 'howto' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
