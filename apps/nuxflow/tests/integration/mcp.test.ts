/**
 * Integration tests for the MCP JSON-RPC endpoint (server/api/v1/mcp.ts).
 *
 * Focused coverage for the two bugs fixed here:
 *   1. Content mutations via MCP tools (`create_content`) now write an audit log row,
 *      matching every other content-mutation route in the codebase.
 *   2. A POST carrying a `sessionId` that isn't bound to this isolate's `activeStreams`
 *      map now returns a clear, distinct JSON-RPC error (and 404 status) instead of
 *      silently executing the request with no way to signal the dropped SSE delivery.
 *
 * This is not a comprehensive test suite for the whole MCP endpoint (out of scope) —
 * just enough to pin down the two fixes above.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole, seedContentType, seedContentItem } from '../helpers/seed'
import { contentItems, auditLogs } from '@nuxflow/db/schema'
import { eq, and } from 'drizzle-orm'
import mcpHandler from '../../server/api/v1/mcp'

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
  query?: Record<string, string>
  apiKeyUserId?: string
  apiKeyRole?: string
  apiKeyScopes?: string[]
}) {
  return createMockEvent({
    method: 'POST',
    siteId: SITE,
    body: opts.body,
    query: opts.query ?? {},
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

describe('POST /api/v1/mcp — unknown/mismatched sessionId', () => {
  it('returns a distinct JSON-RPC error and 404 instead of silently succeeding', async () => {
    const event = mkMcpEvent({
      query: { sessionId: 'session-that-does-not-exist-on-this-isolate' },
      body: { jsonrpc: '2.0', id: 42, method: 'tools/list' },
    })

    const response = await (mcpHandler as HandlerFn)(event) as {
      jsonrpc: string
      id: number | null
      error?: { code: number; message: string }
      result?: unknown
    }

    expect(response.error).toBeTruthy()
    expect(response.error!.code).toBe(-32001)
    expect(response.error!.message).toMatch(/not bound to this Worker isolate/i)
    expect(response.result).toBeUndefined()
    expect((event as unknown as { _status: number })._status).toBe(404)
  })

  it('does not execute the underlying tool call when the session is unbound', async () => {
    const event = mkMcpEvent({
      query: { sessionId: 'another-unbound-session' },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_content',
          arguments: { title: 'Should Not Exist', slug: 'should-not-exist' },
        },
      },
    })

    await (mcpHandler as HandlerFn)(event)

    const db = getCurrentTestDb()
    const item = await db.query.contentItems.findFirst({
      where: eq(contentItems.slug, 'should-not-exist'),
    })
    expect(item).toBeUndefined()
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
