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
import { eq } from 'drizzle-orm'
import { media } from '@nuxflow/db/schema'
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
const { mockGetAiSdkModel, mockGenerateText } = vi.hoisted(() => ({
  mockGetAiSdkModel: vi.fn(),
  mockGenerateText: vi.fn(),
}))

vi.mock('../../server/utils/ai-sdk', () => ({
  getAiSdkModel: mockGetAiSdkModel,
  aiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}))

vi.mock('ai', () => ({
  generateText: mockGenerateText,
}))

const SITE = 'site-ai-01'
let userId: string
let editorId: string
let mediaId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

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
      (seoSuggestHandler as HandlerFn)(mkEvent({ title: 'My Article' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns seoTitle and seoDescription parsed from the AI JSON response', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ title: 'AI Generated Title', description: 'AI Generated Description' }),
    })

    const result = await (seoSuggestHandler as HandlerFn)(
      mkEvent({ title: 'My Article', body: 'Some content about dogs.' }),
    ) as { seoTitle: string; seoDescription: string }

    expect(result.seoTitle).toBe('AI Generated Title')
    expect(result.seoDescription).toBe('AI Generated Description')
  })

  it('falls back to the original title when the AI returns invalid JSON', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({ text: 'this is not valid json at all' })

    const result = await (seoSuggestHandler as HandlerFn)(
      mkEvent({ title: 'Fallback Title' }),
    ) as { seoTitle: string; seoDescription: string }

    expect(result.seoTitle).toBe('Fallback Title')
    expect(result.seoDescription).toBe('')
  })

  it('returns 502 when the AI SDK throws', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockRejectedValueOnce(new Error('Provider network error'))

    await expect(
      (seoSuggestHandler as HandlerFn)(mkEvent({ title: 'Error Test' })),
    ).rejects.toMatchObject({ statusCode: 502 })
  })

  it('returns a validation error when title is missing', async () => {
    await expect(
      (seoSuggestHandler as HandlerFn)(mkEvent({ body: 'some content without a title' })),
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
      (altTextHandler as HandlerFn)(mkEvent({ mediaId })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns 404 when the media item does not exist', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))

    await expect(
      (altTextHandler as HandlerFn)(mkEvent({ mediaId: 'nonexistent-media-id-00000' })),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns trimmed alt text from the AI SDK', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockResolvedValueOnce({ text: '  A cheerful person smiling at the camera  ' })

    const result = await (altTextHandler as HandlerFn)(mkEvent({ mediaId })) as { altText: string }

    expect(result.altText).toBe('A cheerful person smiling at the camera')
  })

  it('uses the original filename as context in the prompt (provider receives a filename-based prompt)', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockResolvedValueOnce({ text: 'Alt text result' })

    await (altTextHandler as HandlerFn)(mkEvent({ mediaId }))

    const [callArgs] = mockGenerateText.mock.calls.at(-1) as [Record<string, unknown>]
    expect(callArgs.prompt as string).toContain('hero-photo.jpg')
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/ai/improve
// ---------------------------------------------------------------------------

describe('POST /api/v1/ai/improve', () => {
  it('returns 503 when no AI model is configured', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(null)

    await expect(
      (improveHandler as HandlerFn)(mkEvent({ text: 'Some text', instruction: 'improve' })),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns the parsed JSON array of alternatives', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockResolvedValueOnce({ text: JSON.stringify(['Alt 1', 'Alt 2', 'Alt 3']) })

    const result = await (improveHandler as HandlerFn)(
      mkEvent({ text: 'Some text', instruction: 'shorten' }),
    ) as { alternatives: string[] }

    expect(result.alternatives).toEqual(['Alt 1', 'Alt 2', 'Alt 3'])
  })

  it('wraps a non-JSON response as a single alternative', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockResolvedValueOnce({ text: 'plain text response' })

    const result = await (improveHandler as HandlerFn)(
      mkEvent({ text: 'Some text' }),
    ) as { alternatives: string[] }

    expect(result.alternatives).toEqual(['plain text response'])
  })

  it('returns 502 when the AI SDK throws', async () => {
    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockRejectedValueOnce(new Error('Rate limited'))

    await expect(
      (improveHandler as HandlerFn)(mkEvent({ text: 'Some text' })),
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

  it('processes only the requested image, skipping non-image media', async () => {
    const db = getCurrentTestDb()
    const docId = await seedMedia(db, SITE, { originalName: 'brochure.pdf', mimeType: 'application/pdf' })

    mockGetAiSdkModel.mockResolvedValueOnce(Symbol('fake-model'))
    mockGenerateText.mockResolvedValueOnce({ text: 'Generated alt text' })

    const result = await (bulkAltTextHandler as HandlerFn)(
      mkEditorEvent({ mediaIds: [mediaId, docId] }),
    ) as { processed: number; skipped: number; total: number }

    expect(result.total).toBe(1)
    expect(result.processed).toBe(1)

    const updated = await db.query.media.findFirst({ where: eq(media.id, mediaId) })
    expect(updated?.altText).toBe('Generated alt text')
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
        mkEvent({ description: 'Write about sustainable travel', tone: 'professional', format: 'prose' }),
      ),
    ).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns trimmed HTML from the AI SDK generateText call', async () => {
    const fakeModel = Symbol('fake-model')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({ text: '  <p>Sustainable travel matters.</p>  ' })

    const result = await (generateContentHandler as HandlerFn)(
      mkEvent({ description: 'Write about sustainable travel', tone: 'professional', format: 'prose' }),
    ) as { html: string }

    expect(result.html).toBe('<p>Sustainable travel matters.</p>')
  })

  it('passes the model and system prompt to generateText', async () => {
    const fakeModel = Symbol('fake-model-2')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockResolvedValueOnce({ text: '<p>Content</p>' })

    await (generateContentHandler as HandlerFn)(
      mkEvent({ description: 'Write something', tone: 'casual', format: 'listicle' }),
    )

    const [callArgs] = mockGenerateText.mock.calls.at(-1) as [Record<string, unknown>]
    expect(callArgs.model).toBe(fakeModel)
    expect(typeof callArgs.system).toBe('string')
    expect((callArgs.system as string).length).toBeGreaterThan(0)
  })

  it('returns a validation error when description is too short', async () => {
    await expect(
      (generateContentHandler as HandlerFn)(mkEvent({ description: 'Hi' })),
    ).rejects.toThrow()
  })

  it('returns 502 when the AI SDK throws', async () => {
    const fakeModel = Symbol('fake-model-3')
    mockGetAiSdkModel.mockResolvedValueOnce(fakeModel)
    mockGenerateText.mockRejectedValueOnce(new Error('Rate limit exceeded'))

    await expect(
      (generateContentHandler as HandlerFn)(
        mkEvent({ description: 'Write about something interesting', tone: 'friendly', format: 'howto' }),
      ),
    ).rejects.toMatchObject({ statusCode: 502 })
  })
})
