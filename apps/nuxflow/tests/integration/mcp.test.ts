/**
 * Integration tests for the MCP JSON-RPC endpoint (server/api/v1/mcp.ts).
 *
 * Covers the Streamable HTTP transport (version negotiation, notifications, refusals),
 * API-key scopes, audit logging and cache/embedding side effects of the content tools.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, auditLogs } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import mcpHandler from '../../server/api/v1/mcp'
import type * as EmbeddingsModule from '../../server/utils/embeddings'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

// rate-limit.ts calls useDb() as a bare Nitro auto-import (no explicit import statement),
// which isn't available in this Vitest environment — mock it out like every other
// integration test covering a rate-limited route (see ai-routes.test.ts, registration.test.ts).
vi.mock('../../server/utils/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}))

const purgeContentCache = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/edge-cache', () => ({ purgeContentCache: (...a: unknown[]) => purgeContentCache(...a) }))
const upsertContentEmbedding = vi.fn().mockResolvedValue(undefined)
const deleteContentEmbedding = vi.fn().mockResolvedValue(undefined)
vi.mock('../../server/utils/embeddings', async importOriginal => ({
  ...(await importOriginal<typeof EmbeddingsModule>()),
  upsertContentEmbedding: (...a: unknown[]) => upsertContentEmbedding(...a),
  deleteContentEmbedding: (...a: unknown[]) => deleteContentEmbedding(...a),
}))

const SITE = 'site-mcp-01'
let authorUserId: string
let pageTypeId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'mcp.localhost' })
  authorUserId = await seedUser(db, { email: 'mcp-author@test.com' })
  await seedRole(db, authorUserId, SITE, 'author')
  pageTypeId = await seedContentType(db, SITE, { slug: 'page', name: 'Pages', singularName: 'Page' })
})

afterAll(teardownTestDb)

function mkMcpEvent(opts: {
  body: unknown
  apiKeyUserId?: string
  apiKeyRole?: string
  apiKeyScopes?: string[]
}) {
  return createMockEvent({
    method: 'POST',
    siteId: SITE,
    body: opts.body,
    apiKeyUserId: opts.apiKeyUserId ?? authorUserId,
    apiKeyRole: opts.apiKeyRole ?? 'author',
    // Defaults to both scopes so existing tests keep exercising read AND write tools —
    // scope-specific enforcement gets its own dedicated tests below.
    apiKeyScopes: opts.apiKeyScopes ?? ['read:content', 'write:content'],
  }) as unknown as H3Event
}

describe('POST /api/v1/mcp — create_content writes an audit log', () => {
  it('creates the content item and a matching audit_logs row', async () => {
    const event = mkMcpEvent({
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_content',
          arguments: { title: 'MCP Created Page', slug: 'mcp-created-page' },
        },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      jsonrpc: string
      id: number
      result: { content: { type: string; text: string }[] }
    }

    expect(response.result.content[0].text).toContain('Success')

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({
      where: eq(contentItems.slug, 'mcp-created-page'),
    })
    expect(item).toBeTruthy()

    const logs = await db.query.auditLogs.findMany({
      where: and(eq(auditLogs.resource, 'content_item'), eq(auditLogs.resourceId, item!.id)),
    })
    expect(logs.length).toBe(1)
    expect(logs[0].action).toBe('create')
    expect(logs[0].userId).toBe(authorUserId)
    expect(logs[0].siteId).toBe(SITE)
  })
})

// Regression coverage for the API key scope enforcement added to mcp.ts — an API key's
// own declared scopes (api-keys/index.post.ts, resolved by 03.api-key-auth.ts onto
// event.context.apiKeyScopes) are a ceiling on top of the issuing user's site role, not
// a substitute for it. Before this, mcp.ts only ever checked apiKeyRole, so a key
// labeled read-only (the default and only scope selectable in the admin UI before this
// fix) could still create/update/delete content via this endpoint.
describe('POST /api/v1/mcp — API key scope enforcement', () => {
  it('rejects create_content for a key scoped to read:content only, despite an author+ role', async () => {
    const event = mkMcpEvent({
      apiKeyScopes: ['read:content'],
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_content',
          arguments: { title: 'Should Not Be Created', slug: 'scope-blocked-page' },
        },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }
    expect(response.result.content[0].text).toMatch(/does not have the "write:content" scope/)

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({ where: eq(contentItems.slug, 'scope-blocked-page') })
    expect(item).toBeUndefined()
  })

  it('rejects list_content for a key with no scopes at all', async () => {
    const event = mkMcpEvent({
      apiKeyScopes: [],
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_content', arguments: { type: 'page' } },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }
    expect(response.result.content[0].text).toMatch(/does not have the "read:content" scope/)
  })

  it('allows create_content for a key scoped to write:content', async () => {
    const event = mkMcpEvent({
      apiKeyScopes: ['write:content'],
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_content',
          arguments: { title: 'Scope Allowed Page', slug: 'scope-allowed-page' },
        },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }
    expect(response.result.content[0].text).toContain('Success')
  })
})

describe('/api/v1/mcp — Streamable HTTP transport', () => {
  it('negotiates the protocol version on initialize', async () => {
    const res = await (mcpHandler as HandlerFn)(mkMcpEvent({
      body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    })) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(res.result.protocolVersion).toBe('2025-03-26')
    expect(res.result.serverInfo.name).toBe('nuxflow')

    const unknown = await (mcpHandler as HandlerFn)(mkMcpEvent({
      body: { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    })) as { result: { protocolVersion: string } }
    expect(unknown.result.protocolVersion).toBe('2025-06-18')
  })

  it('answers a notification with 202 and no body', async () => {
    const event = mkMcpEvent({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } })
    expect(await (mcpHandler as HandlerFn)(event)).toBeNull()
    expect((event as unknown as { _status: number })._status).toBe(202)
  })

  it('answers ping', async () => {
    const res = await (mcpHandler as HandlerFn)(mkMcpEvent({ body: { jsonrpc: '2.0', id: 'p', method: 'ping' } }))
    expect(res).toEqual({ jsonrpc: '2.0', result: {}, id: 'p' })
  })

  it('refuses a batch with a JSON-RPC Invalid Request error', async () => {
    const event = mkMcpEvent({ body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] })
    const res = await (mcpHandler as HandlerFn)(event) as { error: { code: number } }
    expect(res.error.code).toBe(-32600)
    expect((event as unknown as { _status: number })._status).toBe(400)
  })

  it('refuses GET, since the server never opens an SSE stream', async () => {
    const event = createMockEvent({ method: 'GET', siteId: SITE, apiKeyUserId: authorUserId, apiKeyRole: 'author' }) as unknown as H3Event
    await expect((mcpHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 405 })
  })
})

// search_content falls back to FTS5 keyword search whenever Vectorize isn't configured
// (see embeddings.ts's semanticSearch, which returns null in that case) — no Vectorize
// binding exists in this test's mock event, so this exercises the real fallback path
// against the real search_index table (kept in sync by SQLite triggers — see search.test.ts).
describe('POST /api/v1/mcp — search_content tool', () => {
  it('finds a published item by keyword via the FTS5 fallback', async () => {
    const db = getCurrentTestDb()
    await seedContentItem(db, SITE, pageTypeId, {
      title: 'Growing Tomatoes on the Edge',
      excerpt: 'A guide to greenhouse cultivation.',
      status: 'published',
      visibility: 'public',
    })

    const event = mkMcpEvent({
      body: {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'search_content', arguments: { query: 'tomatoes' } },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }

    expect(response.result.content[0].text).toContain('Growing Tomatoes on the Edge')
  })

  it('returns a clear "no matching content" message rather than an empty/ambiguous result', async () => {
    const event = mkMcpEvent({
      body: {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'search_content', arguments: { query: 'zzz-no-such-term-zzz' } },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }

    expect(response.result.content[0].text).toBe('No matching content found.')
  })

  // The fallback used to strip everything but ASCII letters/digits and append `*`, so a
  // query in another script became a bare `*` and FTS5 keywords reached the parser. It now
  // shares toFtsQuery() with GET /api/v1/search.
  it('finds non-Latin text, like the public search does', async () => {
    await seedContentItem(getCurrentTestDb(), SITE, pageTypeId, {
      title: 'Ελληνική συνταγή',
      excerpt: 'Μουσακάς με μελιτζάνες.',
      status: 'published',
      visibility: 'public',
    })

    const event = mkMcpEvent({
      body: { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'search_content', arguments: { query: 'μουσακάς' } } },
    })
    const response = await (mcpHandler as HandlerFn)(event) as { result: { content: { type: string; text: string }[] } }

    expect(response.result.content[0].text).toContain('Ελληνική συνταγή')
  })

  it.each(['tomatoes OR', 'NOT', 'NEAR(', '"', '***', '日本語'])('treats %j as plain text instead of failing', async (query) => {
    const event = mkMcpEvent({
      body: { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'search_content', arguments: { query } } },
    })
    const response = await (mcpHandler as HandlerFn)(event) as { result?: { content: { type: string; text: string }[] }; error?: unknown }

    expect(response.error).toBeUndefined()
    expect(response.result?.content[0].text).not.toMatch(/^Error/)
  })

  it('is rejected without the read:content scope', async () => {
    const event = mkMcpEvent({
      apiKeyScopes: ['write:content'],
      body: {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'search_content', arguments: { query: 'tomatoes' } },
      },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      result: { content: { type: string; text: string }[] }
    }

    expect(response.result.content[0].text).toContain('read:content')
  })
})

describe('POST /api/v1/mcp — content writes keep the edge cache and search index in sync', () => {
  let editorUserId: string

  beforeAll(async () => {
    editorUserId = await seedUser(getCurrentTestDb(), { email: 'mcp-editor@test.com' })
    await seedRole(getCurrentTestDb(), editorUserId, SITE, 'editor')
  })

  async function call(name: string, args: Record<string, unknown>) {
    purgeContentCache.mockClear()
    upsertContentEmbedding.mockClear()
    deleteContentEmbedding.mockClear()
    const event = mkMcpEvent({
      apiKeyUserId: editorUserId,
      apiKeyRole: 'editor',
      body: { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name, arguments: args } },
    })
    const response = await (mcpHandler as HandlerFn)(event) as { result: { content: { text: string }[] } }
    return response.result.content[0]!.text
  }

  it('unpublishing purges the live page and drops it from semantic search', async () => {
    const id = await seedContentItem(getCurrentTestDb(), SITE, pageTypeId, { slug: 'mcp-takedown', title: 'Takedown' })

    expect(await call('update_content', { id, status: 'draft' })).toMatch(/^Success/)

    expect(purgeContentCache).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      slugs: ['mcp-takedown'],
      extraPaths: expect.arrayContaining(['/mcp-takedown']),
    }))
    // upsertContentEmbedding removes the vector itself for a non-public/non-published item.
    expect(upsertContentEmbedding).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ contentItemId: id, status: 'draft' }))
  })

  it('a slug change purges both the old and the new URL', async () => {
    const id = await seedContentItem(getCurrentTestDb(), SITE, pageTypeId, { slug: 'mcp-old-slug' })

    await call('update_content', { id, slug: 'mcp-new-slug' })

    const [, opts] = purgeContentCache.mock.calls[0]! as [unknown, { slugs: string[] }]
    expect(opts.slugs).toEqual(expect.arrayContaining(['mcp-old-slug', 'mcp-new-slug']))
  })

  it('deleting purges the page and deletes its vector', async () => {
    const id = await seedContentItem(getCurrentTestDb(), SITE, pageTypeId, { slug: 'mcp-deleted' })

    expect(await call('delete_content', { id })).toMatch(/^Success/)

    expect(purgeContentCache).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ slugs: ['mcp-deleted'] }))
    expect(deleteContentEmbedding).toHaveBeenCalledWith(expect.anything(), id)
  })

  it('creating a published item purges its URL and embeds it', async () => {
    expect(await call('create_content', { title: 'Fresh', slug: 'mcp-fresh', status: 'published' })).toMatch(/^Success/)

    expect(purgeContentCache).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ slugs: ['mcp-fresh'] }))
    expect(upsertContentEmbedding).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'published', title: 'Fresh' }))
  })
})
