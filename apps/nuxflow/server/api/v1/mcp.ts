import { useDb } from '../../utils/db'
import { roleAtLeast, type Role } from '../../utils/permissions'
import { contentItems } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { ulid } from 'ulid'
import { createEventStream } from 'h3'
import { z } from 'zod'
import { errorMessage } from '../../utils/errors'
import { getContentItem, getContentTypeBySlug } from '../../utils/content-queries'
import { scopedById } from '../../utils/db-helpers'
import { writeAuditLog } from '../../utils/audit'
import { rateLimit } from '../../utils/rate-limit'

const CONTENT_STATUS = z.enum(['draft', 'review', 'published', 'scheduled', 'archived'])
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

// Module-level cache of active SSE streams, scoped to THIS Workers isolate only.
//
// IMPORTANT LIMITATION: Cloudflare Workers give no isolate affinity across requests — the
// GET that opens an SSE stream (populating this map) and a later POST ?sessionId=... that
// wants to deliver a JSON-RPC response over it can land on two different isolates, each with
// its own copy of this module (and therefore its own empty-for-that-session `activeStreams`).
// A live `ReadableStreamDefaultController`/event-stream handle is inherently tied to the
// isolate that created it, so there is no way to serialize it into KV/D1 and "hand it off" to
// whichever isolate happens to receive the POST — the only architecturally correct fix is to
// move session state (and the push itself) into a Durable Object keyed by sessionId, so every
// request for a given session is routed to the single object instance that holds the live
// stream. That is a real future-work item (this codebase already has Durable-Object-adjacent
// patterns via the `agents-sdk`/`durable-objects` tooling) but is out of scope here — this map
// stays a best-effort, same-isolate-only optimization. The POST handler below detects the
// cross-isolate-miss case explicitly and fails loudly (see the sessionId lookup there) instead
// of silently dropping the SSE delivery, which previously produced an undiagnosable client hang.
const activeStreams = new Map<string, ReturnType<typeof createEventStream>>()

export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  const query = getQuery(event)

  // 1. Authenticate Request
  // Authenticated context fields (apiKeyUserId, apiKeyRole, siteId) are pre-populated by global api-key-auth.ts middleware
  const apiKeyUserId = event.context.apiKeyUserId as string | undefined
  const apiKeyRole = event.context.apiKeyRole as string | undefined
  const siteId = event.context.siteId as string | undefined

  if (!apiKeyUserId || !siteId) {
    throw unauthorized('Unauthorized: A valid API Key in the Authorization header is required.')
  }

  // This endpoint is API-key-authenticated but had no rate limiting at all — unlike every
  // other API-key-driven route in this codebase (content mutation, AI generation) that
  // sits behind a `requireRole` + `rateLimit()` pair. Both the SSE handshake (GET) and the
  // JSON-RPC calls (POST, including content mutation tools) share one limit here since
  // there's no separate "read vs write" split once inside the tools/call dispatch below.
  // 60/minute is generous for a single legitimate MCP client (an editor session issuing a
  // steady stream of tool calls) while still bounding abuse of an authenticated key.
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'mcp' })

  // 2. Establish SSE Connection (GET)
  if (method === 'GET') {
    const sessionId = ulid()
    const stream = createEventStream(event)

    activeStreams.set(sessionId, stream)

    stream.onClosed(() => {
      activeStreams.delete(sessionId)
    })

    // Legacy SSE handshake requires sending an initial event mapping to the POST endpoint URL with sessionId
    await stream.push({
      event: 'endpoint',
      data: `/api/v1/mcp?sessionId=${sessionId}`
    })

    return stream.send()
  }

  // 3. Handle JSON-RPC 2.0 Message (POST)
  if (method === 'POST') {
    const sessionId = query.sessionId as string | undefined
    const body = await readBody(event)

    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
      throw badRequest('Invalid JSON-RPC 2.0 payload.')
    }

    const { id, method: rpcMethod, params } = body

    // If the client is using the SSE session flow (it only ever has a sessionId because a
    // prior GET handed it one), a miss here means this POST landed on a different isolate
    // than the one holding the live stream — see the long comment on `activeStreams` above.
    // Fail loudly and distinctly instead of executing the request and quietly discarding the
    // delivery: the previous behavior silently returned a 200 with the mutation applied (for
    // create/update/delete) but no way for an SSE-only listener to ever learn the result.
    let activeStream: ReturnType<typeof createEventStream> | undefined
    if (sessionId) {
      activeStream = activeStreams.get(sessionId)
      if (!activeStream) {
        setResponseStatus(event, 404)
        return {
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: `SSE session "${sessionId}" is not bound to this Worker isolate — it either opened on a different isolate or has expired/closed. Reconnect via GET to obtain a new session before retrying.`,
          },
          id: id ?? null,
        }
      }
    }

    let result: unknown = null
    let error: { code: number; message: string } | null = null

    try {
      const db = useDb(event)

      switch (rpcMethod) {
        case 'initialize': {
          result = {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'nuxflow-mcp',
              version: '0.1.0'
            }
          }
          break
        }

        case 'tools/list': {
          result = {
            tools: [
              {
                name: 'list_content',
                description: 'List pages or posts in the NuxFlow CMS.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['page', 'post'], description: 'Filter by content type slug (default: page)' },
                    status: { type: 'string', enum: ['draft', 'review', 'published', 'scheduled', 'archived'], description: 'Filter by publish status' },
                    limit: { type: 'number', description: 'Maximum number of items to return (default: 20)' }
                  }
                }
              },
              {
                name: 'get_content',
                description: 'Get full details of a specific page or post by its slug or ID.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'The unique 26-character ULID of the content item' },
                    slug: { type: 'string', description: 'The URL slug of the content item' }
                  }
                }
              },
              {
                name: 'create_content',
                description: 'Create a new page or post in NuxFlow.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', description: 'The title of the page' },
                    slug: { type: 'string', description: 'The URL slug for the page' },
                    content: { type: 'string', description: 'The text or HTML content' },
                    type: { type: 'string', enum: ['page', 'post'], description: 'The content type slug (default: page)' },
                    status: { type: 'string', enum: ['draft', 'published'], description: 'The status (default: draft)' }
                  },
                  required: ['title', 'slug']
                }
              },
              {
                name: 'update_content',
                description: 'Update the title, content, or status of an existing page or post.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'The 26-character ULID of the content item to update' },
                    title: { type: 'string', description: 'The new title' },
                    slug: { type: 'string', description: 'The new slug' },
                    content: { type: 'string', description: 'The new content text or HTML' },
                    status: { type: 'string', enum: ['draft', 'review', 'published', 'scheduled', 'archived'], description: 'The new status' }
                  },
                  required: ['id']
                }
              },
              {
                name: 'delete_content',
                description: 'Permanently delete a page or post in NuxFlow.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'The unique 26-character ULID of the content item to delete' }
                  },
                  required: ['id']
                }
              }
            ]
          }
          break
        }

        case 'tools/call': {
          const { name, arguments: args } = params || {}

          if (name === 'list_content') {
            const typeSlug = args?.type || 'page'
            const limit = Math.min(Number(args?.limit) || 20, 50)

            const type = await getContentTypeBySlug(db, siteId, typeSlug)
            if (!type) {
              result = { content: [{ type: 'text', text: `Error: Content type "${typeSlug}" not found.` }] }
              break
            }

            const conditions = [eq(contentItems.siteId, siteId), eq(contentItems.typeId, type.id)]
            if (args?.status) {
              conditions.push(eq(contentItems.status, args.status))
            }

            const items = await db.query.contentItems.findMany({
              where: and(...conditions),
              limit,
              orderBy: [desc(contentItems.updatedAt)],
              columns: { id: true, title: true, slug: true, status: true, updatedAt: true }
            })

            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(items, null, 2)
                }
              ]
            }
          }

          else if (name === 'get_content') {
            const id = args?.id
            const slug = args?.slug

            if (!id && !slug) {
              result = { content: [{ type: 'text', text: 'Error: Must provide either id or slug.' }] }
              break
            }

            const conditions = [eq(contentItems.siteId, siteId)]
            if (id) conditions.push(eq(contentItems.id, id))
            if (slug) conditions.push(eq(contentItems.slug, slug))

            const item = await db.query.contentItems.findFirst({
              where: and(...conditions)
            })

            if (!item) {
              result = { content: [{ type: 'text', text: 'Error: Content item not found.' }] }
            } else {
              result = {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(item, null, 2)
                  }
                ]
              }
            }
          }

          else if (name === 'create_content') {
            if (!roleAtLeast((apiKeyRole ?? 'viewer') as Role, 'author')) {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to create content.` }] }
              break
            }

            const parsed = createContentArgsSchema.safeParse(args)
            if (!parsed.success) {
              result = { content: [{ type: 'text', text: `Error: ${parsed.error.issues.map(i => i.message).join('; ')}` }] }
              break
            }
            const { title, slug: slugVal, status: statusVal = 'draft' } = parsed.data
            const contentVal = parsed.data.content ?? ''
            const typeSlug = parsed.data.type || 'page'

            const type = await getContentTypeBySlug(db, siteId, typeSlug)
            if (!type) {
              result = { content: [{ type: 'text', text: `Error: Content type "${typeSlug}" not found.` }] }
              break
            }

            // Check if slug already exists
            const existing = await db.query.contentItems.findFirst({
              where: and(eq(contentItems.siteId, siteId), eq(contentItems.slug, slugVal))
            })
            if (existing) {
              result = { content: [{ type: 'text', text: `Error: Slug "${slugVal}" is already in use.` }] }
              break
            }

            const newId = ulid()
            await db.insert(contentItems).values({
              id: newId,
              siteId,
              typeId: type.id,
              authorId: apiKeyUserId,
              title,
              slug: slugVal,
              status: statusVal,
              content: contentVal,
              publishedAt: statusVal === 'published' ? new Date().toISOString() : null
            })

            await writeAuditLog(event, apiKeyUserId, {
              action: 'create',
              resource: 'content_item',
              resourceId: newId,
              after: { title, slug: slugVal, status: statusVal, typeId: type.id },
            })

            result = {
              content: [
                {
                  type: 'text',
                  text: `Success: Content item successfully created with ID: ${newId}`
                }
              ]
            }
          }

          else if (name === 'update_content') {
            if (!roleAtLeast((apiKeyRole ?? 'viewer') as Role, 'author')) {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to update content.` }] }
              break
            }

            const parsedUpdate = updateContentArgsSchema.safeParse(args)
            if (!parsedUpdate.success) {
              result = { content: [{ type: 'text', text: `Error: ${parsedUpdate.error.issues.map(i => i.message).join('; ')}` }] }
              break
            }
            const { id } = parsedUpdate.data

            const existing = await getContentItem(db, siteId, id)
            if (!existing) {
              result = { content: [{ type: 'text', text: `Error: Content item with ID "${id}" not found.` }] }
              break
            }

            const updates: Partial<typeof contentItems.$inferSelect> = {
              updatedAt: new Date().toISOString()
            }
            if (parsedUpdate.data.title !== undefined) updates.title = parsedUpdate.data.title
            if (parsedUpdate.data.slug !== undefined) updates.slug = parsedUpdate.data.slug
            if (parsedUpdate.data.content !== undefined) updates.content = parsedUpdate.data.content
            if (parsedUpdate.data.status !== undefined) {
              if (parsedUpdate.data.status === 'published' && !roleAtLeast((apiKeyRole ?? 'viewer') as Role, 'editor')) {
                result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to publish content.` }] }
                break
              }
              updates.status = parsedUpdate.data.status
              if (parsedUpdate.data.status === 'published' && !existing.publishedAt) {
                updates.publishedAt = new Date().toISOString()
              }
            }

            await db.update(contentItems)
              .set(updates)
              .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

            await writeAuditLog(event, apiKeyUserId, {
              action: 'update',
              resource: 'content_item',
              resourceId: id,
              before: existing,
              after: updates,
            })

            result = {
              content: [
                {
                  type: 'text',
                  text: `Success: Content item ${id} successfully updated.`
                }
              ]
            }
          }

          else if (name === 'delete_content') {
            const id = args?.id
            if (!id) {
              result = { content: [{ type: 'text', text: 'Error: id is required.' }] }
              break
            }

            // Enforce editor role minimum to perform deletions
            if (!roleAtLeast((apiKeyRole ?? 'viewer') as Role, 'editor')) {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to perform deletions.` }] }
              break
            }

            const existing = await getContentItem(db, siteId, id)
            if (!existing) {
              result = { content: [{ type: 'text', text: `Error: Content item with ID "${id}" not found.` }] }
              break
            }

            await db.delete(contentItems)
              .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

            await writeAuditLog(event, apiKeyUserId, {
              action: 'delete',
              resource: 'content_item',
              resourceId: id,
              before: existing,
            })

            result = {
              content: [
                {
                  type: 'text',
                  text: `Success: Content item ${id} has been permanently deleted.`
                }
              ]
            }
          }

          else {
            result = { content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }] }
          }
          break
        }

        default: {
          error = { code: -32601, message: `Method not found: ${rpcMethod}` }
          break
        }
      }
    } catch (err: unknown) {
      error = { code: -32603, message: errorMessage(err, 'Internal error') }
    }

    // Format final JSON-RPC response payload
    const responsePayload = error
      ? { jsonrpc: '2.0', error, id }
      : { jsonrpc: '2.0', result, id }

    // The sessionId-miss case is already handled above (before execution), so if we get here
    // with an activeStream it's guaranteed to still belong to this isolate.
    if (activeStream) {
      await activeStream.push({
        event: 'message',
        data: JSON.stringify(responsePayload)
      })
    }

    // Always return in the POST body to support Streamable HTTP natively
    return responsePayload
  }

  throw createError({ statusCode: 405, message: 'Method Not Allowed' })
})
