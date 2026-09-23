/**
 * Integration tests for POST /api/public/listen/:slug — "Listen to this article" TTS.
 * Workers AI is mocked (no real network calls).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  useReplicaDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const mockGetWorkersAiBinding = vi.fn()
vi.mock('../../server/utils/cf-env', () => ({
  getWorkersAiBinding: (...args: unknown[]) => mockGetWorkersAiBinding(...args),
}))

const mockGenerateSpeech = vi.fn()
vi.mock('ai', () => ({
  generateSpeech: (...args: unknown[]) => mockGenerateSpeech(...args),
}))

vi.mock('workers-ai-provider', () => ({
  createWorkersAI: () => ({ speech: (modelId: string) => ({ modelId }) }),
}))

const { default: listenHandler } = await import('../../server/api/public/listen/[slug].post')

const SITE = 'site-listen-01'
let typeId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'listen.localhost' })
  typeId = await seedContentType(db, SITE)
})

afterAll(teardownTestDb)

function mkEvent(slug: string) {
  return createMockEvent({ siteId: SITE, params: { slug } }) as unknown as H3Event
}

const PROSE_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This is the article body.' }] }],
}

describe('POST /api/public/listen/:slug', () => {
  it('returns 503 when the Workers AI binding is unavailable', async () => {
    mockGetWorkersAiBinding.mockReturnValue(null)
    await expect((listenHandler as HandlerFn)(mkEvent('any-slug'))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('returns 404 for a nonexistent slug', async () => {
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await expect((listenHandler as HandlerFn)(mkEvent('does-not-exist'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 404 for a draft (unpublished) item — same visibility scope as public search', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, { slug: 'draft-article', status: 'draft', content: PROSE_DOC })
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await expect((listenHandler as HandlerFn)(mkEvent('draft-article'))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 422 for a Canvas page — no single article text to read', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, {
      slug: 'canvas-page',
      content: { type: 'canvas', blocks: [{ id: '1', type: 'canvas-hero', props: {} }] },
    })
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await expect((listenHandler as HandlerFn)(mkEvent('canvas-page'))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns 422 for a prose page with no extractable text', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, { slug: 'empty-article', content: { type: 'doc', content: [] } })
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    await expect((listenHandler as HandlerFn)(mkEvent('empty-article'))).rejects.toMatchObject({ statusCode: 422 })
  })

  it('returns generated audio bytes for a published prose page', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, typeId, { slug: 'real-article', content: PROSE_DOC })
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    const audioBytes = new Uint8Array([1, 2, 3, 4])
    mockGenerateSpeech.mockResolvedValueOnce({ audio: { uint8Array: audioBytes } })

    const event = mkEvent('real-article')
    const result = await (listenHandler as HandlerFn)(event)

    expect(result).toBe(audioBytes)
    const [callArgs] = mockGenerateSpeech.mock.calls.at(-1) as [{ text: string }]
    expect(callArgs.text).toContain('This is the article body.')
  })
})
