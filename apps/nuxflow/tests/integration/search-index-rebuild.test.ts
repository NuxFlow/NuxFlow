/**
 * The smart-search rebuild (server/utils/search-index-rebuild.ts): re-embeds every
 * published, public page into Vectorize when the index's model changes, a few batches per
 * task run, and does nothing once it's done. Real DB; Vectorize, Workers AI and KV faked.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { sites } from '@nuxflow/db/schema'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedContentType, seedContentItem } from '../helpers/seed'
import type * as CfEnv from '../../server/utils/cf-env'

vi.mock('../../server/utils/db', () => ({ useDb: () => getCurrentTestDb(), getD1: () => null }))

const kvStore = new Map<string, string>()
const kv = {
  get: vi.fn(async (key: string, type?: string) => {
    const v = kvStore.get(key)
    return v == null ? null : type === 'json' ? JSON.parse(v) : v
  }),
  put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value) }),
}
const index = {
  describe: vi.fn(),
  upsert: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
  deleteByIds: vi.fn(),
}
vi.mock('../../server/utils/cf-env', async importOriginal => ({
  ...(await importOriginal<typeof CfEnv>()),
  getVectorizeIndex: () => index,
  getWorkersAiBinding: () => ({ run: vi.fn() }),
  getCfBindings: () => ({ kv, loader: null, r2: null }),
}))

const { mockEmbedMany } = vi.hoisted(() => ({ mockEmbedMany: vi.fn() }))
vi.mock('ai', () => ({ embed: vi.fn(), embedMany: mockEmbedMany }))
vi.mock('workers-ai-provider', () => ({
  createWorkersAI: () => ({ textEmbedding: (modelId: string) => ({ modelId }) }),
}))

const { runSearchIndexRebuild, restartSearchIndexRebuild, searchIndexStatus } = await import('../../server/utils/search-index-rebuild')
const { clearSearchIndexInfoCache } = await import('../../server/utils/embeddings')

const event = { context: {} } as unknown as H3Event
const SITE_A = 'site-reindex-a'
const SITE_B = 'site-reindex-b'
const MOVING = 'site-reindex-moving'
const ids: Record<string, string> = {}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  for (const id of [SITE_A, SITE_B, MOVING]) await seedSite(db, { id, domain: `${id}.localhost` })
  await db.update(sites).set({ moveState: 'incoming' }).where(eq(sites.id, MOVING))
  const typeA = await seedContentType(db, SITE_A, { slug: 'page' })
  const typeB = await seedContentType(db, SITE_B, { slug: 'page' })
  const typeM = await seedContentType(db, MOVING, { slug: 'page' })
  ids.a = await seedContentItem(db, SITE_A, typeA, { slug: 'a', title: 'Página A', status: 'published', visibility: 'public' })
  ids.b = await seedContentItem(db, SITE_B, typeB, { slug: 'b', title: 'Page B', status: 'published', visibility: 'public' })
  ids.draft = await seedContentItem(db, SITE_A, typeA, { slug: 'draft', title: 'Draft', status: 'draft' })
  ids.members = await seedContentItem(db, SITE_A, typeA, { slug: 'members', title: 'Members', status: 'published', visibility: 'members' })
  ids.moving = await seedContentItem(db, MOVING, typeM, { slug: 'm', title: 'Mid-move copy', status: 'published', visibility: 'public' })
})
afterAll(teardownTestDb)

beforeEach(() => {
  kvStore.clear()
  clearSearchIndexInfoCache()
  index.upsert.mockClear()
  index.describe.mockResolvedValue({ dimensions: 1024, vectorCount: 0 })
  mockEmbedMany.mockReset().mockImplementation(async ({ values }: { values: string[] }) => ({
    embeddings: values.map(() => Array.from({ length: 1024 }, () => 0.5)),
  }))
})

describe('runSearchIndexRebuild', () => {
  it('embeds every published public page of every served site, each in its own namespace, then stops', async () => {
    const state = await runSearchIndexRebuild(event, getCurrentTestDb())
    expect(state).toMatchObject({ status: 'done', model: '@cf/baai/bge-m3', processed: 2 })
    expect(mockEmbedMany).toHaveBeenCalledWith(expect.objectContaining({ model: { modelId: '@cf/baai/bge-m3' } }))

    const written = index.upsert.mock.calls.flatMap(c => c[0] as Array<{ id: string; namespace: string }>)
    expect(written.map(v => [v.id, v.namespace]).sort()).toEqual([[ids.a, SITE_A], [ids.b, SITE_B]].sort())

    // Done for this model: the next run does nothing.
    index.upsert.mockClear()
    mockEmbedMany.mockClear()
    expect(await runSearchIndexRebuild(event, getCurrentTestDb())).toMatchObject({ status: 'done' })
    expect(mockEmbedMany).not.toHaveBeenCalled()
  })

  it('starts again by itself when the index changes model', async () => {
    index.describe.mockResolvedValue({ dimensions: 768 })
    mockEmbedMany.mockImplementation(async ({ values }: { values: string[] }) => ({ embeddings: values.map(() => Array.from({ length: 768 }, () => 0.5)) }))
    await runSearchIndexRebuild(event, getCurrentTestDb())
    expect(JSON.parse(kvStore.get('search-index:rebuild')!)).toMatchObject({ model: '@cf/baai/bge-base-en-v1.5', status: 'done' })

    clearSearchIndexInfoCache()
    index.describe.mockResolvedValue({ dimensions: 1024 })
    mockEmbedMany.mockImplementation(async ({ values }: { values: string[] }) => ({ embeddings: values.map(() => Array.from({ length: 1024 }, () => 0.5)) }))
    const state = await runSearchIndexRebuild(event, getCurrentTestDb())
    expect(state).toMatchObject({ model: '@cf/baai/bge-m3', status: 'done', processed: 2 })
  })

  it('keeps its place when a batch fails, and never treats a failed describe() as a model change', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockEmbedMany.mockRejectedValueOnce(new Error('Workers AI busy'))
    const failed = await runSearchIndexRebuild(event, getCurrentTestDb())
    expect(failed).toMatchObject({ status: 'running', processed: 0, lastError: 'Workers AI busy' })

    clearSearchIndexInfoCache()
    index.describe.mockRejectedValueOnce(new Error('describe failed'))
    expect(await runSearchIndexRebuild(event, getCurrentTestDb())).toBeNull()
    expect(JSON.parse(kvStore.get('search-index:rebuild')!)).toMatchObject({ status: 'running', lastError: 'Workers AI busy' })

    expect(await runSearchIndexRebuild(event, getCurrentTestDb())).toMatchObject({ status: 'done', processed: 2 })
    spy.mockRestore()
  })

  it('can be started over from Super Admin, and reports progress', async () => {
    await runSearchIndexRebuild(event, getCurrentTestDb())
    const restarted = await restartSearchIndexRebuild(event)
    expect(restarted).toMatchObject({ status: 'running', processed: 0, cursor: null })

    const status = await searchIndexStatus(event, getCurrentTestDb())
    expect(status).toMatchObject({ available: true, dimensions: 1024, multilingual: true, indexablePages: 2, rebuild: { status: 'running' } })
  })
})
