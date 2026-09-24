import type { H3Event } from 'h3'
import { z } from 'zod'
import { and, eq, desc, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Db } from './db'
import { contentItems } from '@nuxflow/db/schema'
import { roleAtLeast, hasApiKeyScope, canEditContentItem, AUTHOR_SETTABLE_STATUSES, type Role, type ApiKeyScope } from './permissions'
import { getContentItem, getContentTypeBySlug } from './content-queries'
import { scopedById } from './db-helpers'
import { writeAuditLog } from './audit'
import { semanticSearch } from './embeddings'

// Tool implementations for the MCP server (server/api/v1/mcp.ts). Extracted out of that
// file so it stays protocol/session plumbing (SSE handshake, JSON-RPC dispatch) while the
// actual "what does this tool do" logic — and its input validation — lives here.

export interface McpToolContext {
  event: H3Event
  db: Db
  siteId: string
  apiKeyUserId: string
  apiKeyRole: string | undefined
}

type McpToolResult = { content: { type: 'text'; text: string }[] }

function textResult(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] }
}

// The key's own declared scopes (set in api-keys/index.post.ts, resolved onto the request
// by 03.api-key-auth.ts) are a ceiling on top of the issuing user's site role, not a
// substitute for it — a key can be scoped down to read-only even when issued by an
// editor/admin. Every tool below needs its matching scope in addition to whatever role
// check it already performs.
function apiKeyRoleAtLeast(apiKeyRole: string | undefined, minimum: Role): boolean {
  return roleAtLeast((apiKeyRole ?? 'viewer') as Role, minimum)
}

const CONTENT_STATUS = z.enum(['draft', 'review', 'published', 'scheduled', 'archived'])

// Each tool's Zod schema (runtime validation, via safeParse below) is co-located with its
// hand-written JSON-Schema `inputSchema` (advertised to MCP clients via tools/list) in the
// same TOOLS entry specifically so the two can't silently drift apart the way they could
// when they lived in two unrelated places in mcp.ts. There's no zod-to-json-schema (or
// equivalent) dependency in this project to derive one from the other automatically — if
// one is ever added, this is the place to generate `inputSchema` from `argsSchema` instead
// of maintaining both by hand. Until then: **when you change an argsSchema below, update
// its sibling inputSchema in the same edit.**

const listContentArgsSchema = z.object({
  type: z.string().min(1).optional(),
  status: CONTENT_STATUS.optional(),
  limit: z.coerce.number().int().positive().optional(),
})

const getContentArgsSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
})

const createContentArgsSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(500),
  content: z.unknown().optional(),
  type: z.string().optional(),
  status: CONTENT_STATUS.optional(),
})

const updateContentArgsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(500).optional(),
  content: z.unknown().optional(),
  status: CONTENT_STATUS.optional(),
})

const deleteContentArgsSchema = z.object({
  id: z.string().min(1),
})

const searchContentArgsSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().positive().optional(),
})

interface McpToolDefinition {
  description: string
  scope: ApiKeyScope
  inputSchema: Record<string, unknown>
}

// The registry driving `tools/list` — description + JSON-Schema `inputSchema` only.
// Actual argument validation happens per-tool in `callTool` below via each tool's own
// `*ArgsSchema.safeParse()`, matching the shape of these inputSchemas (see the co-location
// comment above).
export const MCP_TOOLS: Record<string, McpToolDefinition> = {
  list_content: {
    description: 'List pages or posts in the NuxFlow CMS.',
    scope: 'read:content',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['page', 'post'], description: 'Filter by content type slug (default: page)' },
        status: { type: 'string', enum: ['draft', 'review', 'published', 'scheduled', 'archived'], description: 'Filter by publish status' },
        limit: { type: 'number', description: 'Maximum number of items to return (default: 20)' },
      },
    },
  },
  get_content: {
    description: 'Get full details of a specific page or post by its slug or ID.',
    scope: 'read:content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique 26-character ULID of the content item' },
        slug: { type: 'string', description: 'The URL slug of the content item' },
      },
    },
  },
  create_content: {
    description: 'Create a new page or post in NuxFlow.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the page' },
        slug: { type: 'string', description: 'The URL slug for the page' },
        content: { type: 'string', description: 'The text or HTML content' },
        type: { type: 'string', enum: ['page', 'post'], description: 'The content type slug (default: page)' },
        status: { type: 'string', enum: ['draft', 'published'], description: 'The status (default: draft)' },
      },
      required: ['title', 'slug'],
    },
  },
  update_content: {
    description: 'Update the title, content, or status of an existing page or post.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The 26-character ULID of the content item to update' },
        title: { type: 'string', description: 'The new title' },
        slug: { type: 'string', description: 'The new slug' },
        content: { type: 'string', description: 'The new content text or HTML' },
        status: { type: 'string', enum: ['draft', 'review', 'published', 'scheduled', 'archived'], description: 'The new status' },
      },
      required: ['id'],
    },
  },
  delete_content: {
    description: 'Permanently delete a page or post in NuxFlow.',
    scope: 'write:content',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique 26-character ULID of the content item to delete' },
      },
      required: ['id'],
    },
  },
  search_content: {
    description: 'Search this site\'s published content by natural-language topic or keyword. Prefer this over list_content when you don\'t already know the exact type/slug and want to find relevant pages or posts by what they\'re about — it grounds answers in the site\'s own real content instead of guessing. Uses semantic (vector) search when the site has it configured, and falls back to keyword search otherwise.',
    scope: 'read:content',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
      },
      required: ['query'],
    },
  },
}

/** The `tools` array returned from the `tools/list` JSON-RPC method. */
export function listToolDescriptors() {
  return Object.entries(MCP_TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  }))
}

async function listContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const parsed = listContentArgsSchema.safeParse(args)
  if (!parsed.success) {
    return textResult(`Error: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const typeSlug = parsed.data.type || 'page'
  const limit = Math.min(parsed.data.limit ?? 20, 50)

  const type = await getContentTypeBySlug(ctx.db, ctx.siteId, typeSlug)
  if (!type) {
    return textResult(`Error: Content type "${typeSlug}" not found.`)
  }

  const conditions = [eq(contentItems.siteId, ctx.siteId), eq(contentItems.typeId, type.id)]
  if (parsed.data.status) {
    conditions.push(eq(contentItems.status, parsed.data.status))
  }

  const items = await ctx.db.query.contentItems.findMany({
    where: and(...conditions),
    limit,
    orderBy: [desc(contentItems.updatedAt)],
    columns: { id: true, title: true, slug: true, status: true, updatedAt: true },
  })

  return textResult(JSON.stringify(items, null, 2))
}

async function getContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const parsed = getContentArgsSchema.safeParse(args)
  if (!parsed.success) {
    return textResult(`Error: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const { id, slug } = parsed.data

  if (!id && !slug) {
    return textResult('Error: Must provide either id or slug.')
  }

  const conditions = [eq(contentItems.siteId, ctx.siteId)]
  if (id) conditions.push(eq(contentItems.id, id))
  if (slug) conditions.push(eq(contentItems.slug, slug))

  const item = await ctx.db.query.contentItems.findFirst({
    where: and(...conditions),
  })

  if (!item) return textResult('Error: Content item not found.')
  return textResult(JSON.stringify(item, null, 2))
}

async function createContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  if (!apiKeyRoleAtLeast(ctx.apiKeyRole, 'author')) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" is unauthorized to create content.`)
  }

  const parsed = createContentArgsSchema.safeParse(args)
  if (!parsed.success) {
    return textResult(`Error: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const { title, slug: slugVal, status: statusVal = 'draft' } = parsed.data
  if (!AUTHOR_SETTABLE_STATUSES.has(statusVal) && !apiKeyRoleAtLeast(ctx.apiKeyRole, 'editor')) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" is unauthorized to publish content.`)
  }
  const contentVal = parsed.data.content ?? ''
  const typeSlug = parsed.data.type || 'page'

  const type = await getContentTypeBySlug(ctx.db, ctx.siteId, typeSlug)
  if (!type) {
    return textResult(`Error: Content type "${typeSlug}" not found.`)
  }

  // Check if slug already exists
  const existing = await ctx.db.query.contentItems.findFirst({
    where: and(eq(contentItems.siteId, ctx.siteId), eq(contentItems.slug, slugVal)),
  })
  if (existing) {
    return textResult(`Error: Slug "${slugVal}" is already in use.`)
  }

  const newId = ulid()
  await ctx.db.insert(contentItems).values({
    id: newId,
    siteId: ctx.siteId,
    typeId: type.id,
    authorId: ctx.apiKeyUserId,
    title,
    slug: slugVal,
    status: statusVal,
    content: contentVal,
    publishedAt: statusVal === 'published' ? new Date().toISOString() : null,
  })

  await writeAuditLog(ctx.event, ctx.apiKeyUserId, {
    action: 'create',
    resource: 'content_item',
    resourceId: newId,
    after: { title, slug: slugVal, status: statusVal, typeId: type.id },
  })

  return textResult(`Success: Content item successfully created with ID: ${newId}`)
}

async function updateContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  if (!apiKeyRoleAtLeast(ctx.apiKeyRole, 'author')) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" is unauthorized to update content.`)
  }

  const parsedUpdate = updateContentArgsSchema.safeParse(args)
  if (!parsedUpdate.success) {
    return textResult(`Error: ${parsedUpdate.error.issues.map(i => i.message).join('; ')}`)
  }
  const { id } = parsedUpdate.data

  const existing = await getContentItem(ctx.db, ctx.siteId, id)
  if (!existing) {
    return textResult(`Error: Content item with ID "${id}" not found.`)
  }
  // Same rule as PATCH /api/v1/content/:id — authors only touch their own unpublished items.
  if (!canEditContentItem((ctx.apiKeyRole ?? 'viewer') as Role, ctx.apiKeyUserId, existing)) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" may only update its own draft or in-review content.`)
  }

  const updates: Partial<typeof contentItems.$inferSelect> = {
    updatedAt: new Date().toISOString(),
  }
  if (parsedUpdate.data.title !== undefined) updates.title = parsedUpdate.data.title
  if (parsedUpdate.data.slug !== undefined) updates.slug = parsedUpdate.data.slug
  if (parsedUpdate.data.content !== undefined) updates.content = parsedUpdate.data.content
  if (parsedUpdate.data.status !== undefined) {
    if (!AUTHOR_SETTABLE_STATUSES.has(parsedUpdate.data.status) && !apiKeyRoleAtLeast(ctx.apiKeyRole, 'editor')) {
      return textResult(`Error: Role "${ctx.apiKeyRole}" is unauthorized to publish, schedule, or archive content.`)
    }
    updates.status = parsedUpdate.data.status
    if (parsedUpdate.data.status === 'published' && !existing.publishedAt) {
      updates.publishedAt = new Date().toISOString()
    }
  }

  await ctx.db.update(contentItems)
    .set(updates)
    .where(scopedById(contentItems.id, id, contentItems.siteId, ctx.siteId))

  await writeAuditLog(ctx.event, ctx.apiKeyUserId, {
    action: 'update',
    resource: 'content_item',
    resourceId: id,
    before: existing,
    after: updates,
  })

  return textResult(`Success: Content item ${id} successfully updated.`)
}

async function deleteContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const parsed = deleteContentArgsSchema.safeParse(args)
  if (!parsed.success) {
    return textResult(`Error: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const { id } = parsed.data

  // Enforce editor role minimum to perform deletions
  if (!apiKeyRoleAtLeast(ctx.apiKeyRole, 'editor')) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" is unauthorized to perform deletions.`)
  }

  const existing = await getContentItem(ctx.db, ctx.siteId, id)
  if (!existing) {
    return textResult(`Error: Content item with ID "${id}" not found.`)
  }
  // Same rule as PATCH /api/v1/content/:id — authors only touch their own unpublished items.
  if (!canEditContentItem((ctx.apiKeyRole ?? 'viewer') as Role, ctx.apiKeyUserId, existing)) {
    return textResult(`Error: Role "${ctx.apiKeyRole}" may only update its own draft or in-review content.`)
  }

  await ctx.db.delete(contentItems)
    .where(scopedById(contentItems.id, id, contentItems.siteId, ctx.siteId))

  await writeAuditLog(ctx.event, ctx.apiKeyUserId, {
    action: 'delete',
    resource: 'content_item',
    resourceId: id,
    before: existing,
  })

  return textResult(`Success: Content item ${id} has been permanently deleted.`)
}

async function searchContent(args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const parsed = searchContentArgsSchema.safeParse(args)
  if (!parsed.success) {
    return textResult(`Error: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const { query } = parsed.data
  const limit = Math.min(parsed.data.limit ?? 10, 20)

  const semantic = await semanticSearch(ctx.event, ctx.siteId, query, limit)
  if (semantic !== null) {
    if (!semantic.length) return textResult('No matching content found.')
    return textResult(JSON.stringify(semantic.map(m => ({ id: m.contentItemId, title: m.title, score: m.score })), null, 2))
  }

  // No Vectorize index configured on this deployment — fall back to FTS5 keyword search
  // over the same published/public corpus (see search.get.ts), so this tool always works
  // regardless of whether the site has set up semantic search.
  const safe = query.replace(/[^a-z0-9 ]/gi, '') + '*'
  const rawResults = await ctx.db.run(sql`
    SELECT content_item_id, title
    FROM search_index
    WHERE search_index MATCH ${safe} AND site_id = ${ctx.siteId}
    ORDER BY rank
    LIMIT ${limit}
  `)
  const raw = rawResults as unknown as { rows?: unknown[]; results?: unknown[] }
  const rows = (raw.rows ?? raw.results ?? []) as Record<string, unknown>[]
  if (!rows.length) return textResult('No matching content found.')
  return textResult(JSON.stringify(rows.map(r => ({ id: r.content_item_id, title: r.title })), null, 2))
}

/**
 * Dispatches a `tools/call` request to the named tool's implementation, after checking
 * the calling API key's declared scope covers what the tool needs (a ceiling on top of
 * the issuing user's site role — see apiKeyRoleAtLeast above for the role half of this).
 * Returns the MCP `result` payload directly (never throws for a business-logic failure —
 * those come back as `{ content: [{ type: 'text', text: 'Error: ...' }] }`, matching how
 * every tool here always has, so a client sees a normal tool result either way).
 */
export async function callTool(name: string, args: unknown, ctx: McpToolContext): Promise<McpToolResult> {
  const def = MCP_TOOLS[name]
  if (!def) {
    return textResult(`Error: Unknown tool "${name}"`)
  }

  if (!hasApiKeyScope(ctx.event, def.scope)) {
    return textResult(`Error: This API key does not have the "${def.scope}" scope required for "${name}".`)
  }

  switch (name) {
    case 'list_content': return listContent(args, ctx)
    case 'get_content': return getContent(args, ctx)
    case 'create_content': return createContent(args, ctx)
    case 'update_content': return updateContent(args, ctx)
    case 'delete_content': return deleteContent(args, ctx)
    case 'search_content': return searchContent(args, ctx)
    default: return textResult(`Error: Unknown tool "${name}"`)
  }
}
