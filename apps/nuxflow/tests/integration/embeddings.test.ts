/**
 * Tests for server/utils/embeddings.ts — the application-level equivalent of the FTS5
 * triggers for Vectorize (a DB trigger can't call an external service). Previously
 * untested. The Vectorize/Workers AI bindings are both mocked; no real network calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'

const mockGetWorkersAiBinding = vi.fn()
const mockGetVectorizeIndex = vi.fn()
vi.mock('../../server/utils/cf-env', () => ({
  getWorkersAiBinding: (...args: unknown[]) => mockGetWorkersAiBinding(...args),
  getVectorizeIndex: (...args: unknown[]) => mockGetVectorizeIndex(...args),
}))

const mockEmbed = vi.fn()
vi.mock('ai', () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
}))

vi.mock('workers-ai-provider', () => ({
  createWorkersAI: () => ({ textEmbedding: (modelId: string) => ({ modelId }) }),
}))

const { upsertContentEmbedding, deleteContentEmbedding, semanticSearch } = await import('../../server/utils/embeddings')

function fakeEvent(): H3Event {
  return { context: { siteId: 'site-01' } } as unknown as H3Event
}

function fakeIndex() {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
    getByIds: vi.fn(),
    describe: vi.fn(),
    insert: vi.fn(),
  }
}

beforeEach(() => {
  mockGetWorkersAiBinding.mockReset()
  mockGetVectorizeIndex.mockReset()
  mockEmbed.mockReset()
})

const BASE_INPUT = {
  contentItemId: 'item-01',
  siteId: 'site-01',
  title: 'Growing Tomatoes',
  excerpt: 'A guide to greenhouse cultivation.',
  seoDescription: null,
  status: 'published',
  visibility: 'public',
}

describe('upsertContentEmbedding', () => {
  it('no-ops without throwing when no Vectorize index is configured', async () => {
    mockGetVectorizeIndex.mockReturnValue(null)
    await expect(upsertContentEmbedding(fakeEvent(), BASE_INPUT)).resolves.toBeUndefined()
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('deletes the vector instead of upserting when the item is not published+public', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)

    await upsertContentEmbedding(fakeEvent(), { ...BASE_INPUT, status: 'draft' })

    expect(index.deleteByIds).toHaveBeenCalledWith(['item-01'])
    expect(index.upsert).not.toHaveBeenCalled()
  })

  it('deletes rather than upserts for a published but non-public (member-only) item', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)

    await upsertContentEmbedding(fakeEvent(), { ...BASE_INPUT, visibility: 'private' })

    expect(index.deleteByIds).toHaveBeenCalledWith(['item-01'])
    expect(index.upsert).not.toHaveBeenCalled()
  })

  it('upserts with the content id, siteId namespace, and title metadata for a qualifying item', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })

    await upsertContentEmbedding(fakeEvent(), BASE_INPUT)

    expect(index.upsert).toHaveBeenCalledWith([{
      id: 'item-01',
      values: [0.1, 0.2, 0.3],
      namespace: 'site-01',
      metadata: { title: 'Growing Tomatoes' },
    }])
  })

  it('embeds title + excerpt, matching what FTS5 indexes', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockEmbed.mockResolvedValue({ embedding: [0.1] })

    await upsertContentEmbedding(fakeEvent(), BASE_INPUT)

    const [callArgs] = mockEmbed.mock.calls.at(-1) as [{ value: string }]
    expect(callArgs.value).toContain('Growing Tomatoes')
    expect(callArgs.value).toContain('A guide to greenhouse cultivation.')
  })

  it('falls back to seoDescription when excerpt is absent', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockEmbed.mockResolvedValue({ embedding: [0.1] })

    await upsertContentEmbedding(fakeEvent(), { ...BASE_INPUT, excerpt: null, seoDescription: 'SEO fallback text' })

    const [callArgs] = mockEmbed.mock.calls.at(-1) as [{ value: string }]
    expect(callArgs.value).toContain('SEO fallback text')
  })

  it('skips the upsert (no embed call) when the AI binding is unavailable', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue(null)

    await upsertContentEmbedding(fakeEvent(), BASE_INPUT)

    expect(mockEmbed).not.toHaveBeenCalled()
    expect(index.upsert).not.toHaveBeenCalled()
  })

  it('swallows a Vectorize error rather than throwing — a background enrichment must never fail the caller', async () => {
    const index = fakeIndex()
    index.upsert.mockRejectedValue(new Error('Vectorize is down'))
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockEmbed.mockResolvedValue({ embedding: [0.1] })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(upsertContentEmbedding(fakeEvent(), BASE_INPUT)).resolves.toBeUndefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe('deleteContentEmbedding', () => {
  it('no-ops without a Vectorize index', async () => {
    mockGetVectorizeIndex.mockReturnValue(null)
    await expect(deleteContentEmbedding(fakeEvent(), 'item-01')).resolves.toBeUndefined()
  })

  it('deletes the vector by id when Vectorize is configured', async () => {
    const index = fakeIndex()
    mockGetVectorizeIndex.mockReturnValue(index)

    await deleteContentEmbedding(fakeEvent(), 'item-01')

    expect(index.deleteByIds).toHaveBeenCalledWith(['item-01'])
  })
})

describe('semanticSearch', () => {
  it('returns null when no Vectorize index is configured', async () => {
    mockGetVectorizeIndex.mockReturnValue(null)
    const result = await semanticSearch(fakeEvent(), 'site-01', 'tomatoes')
    expect(result).toBeNull()
  })

  it('returns null when Vectorize is configured but the AI binding is not (can\'t embed the query)', async () => {
    mockGetVectorizeIndex.mockReturnValue(fakeIndex())
    mockGetWorkersAiBinding.mockReturnValue(null)
    const result = await semanticSearch(fakeEvent(), 'site-01', 'tomatoes')
    expect(result).toBeNull()
  })

  it('queries with the siteId namespace and maps matches to SemanticMatch shape', async () => {
    const index = fakeIndex()
    index.query.mockResolvedValue({
      matches: [
        { id: 'item-01', score: 0.92, metadata: { title: 'Growing Tomatoes' } },
        { id: 'item-02', score: 0.81, metadata: {} },
      ],
    })
    mockGetVectorizeIndex.mockReturnValue(index)
    mockGetWorkersAiBinding.mockReturnValue({ run: vi.fn() })
    mockEmbed.mockResolvedValue({ embedding: [0.1, 0.2] })

    const result = await semanticSearch(fakeEvent(), 'site-01', 'tomatoes', 5)

    expect(index.query).toHaveBeenCalledWith([0.1, 0.2], { topK: 5, namespace: 'site-01', returnMetadata: 'indexed' })
    expect(result).toEqual([
      { contentItemId: 'item-01', score: 0.92, title: 'Growing Tomatoes' },
      { contentItemId: 'item-02', score: 0.81, title: undefined },
    ])
  })
})
