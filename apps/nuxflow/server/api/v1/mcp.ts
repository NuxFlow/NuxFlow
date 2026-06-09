import { useDb } from '../../utils/db'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'
import { ulid } from 'ulid'
import { createEventStream } from 'h3'

// Module-level cache for active SSE streams per Workers isolate
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
    throw createError({
      statusCode: 401,
      message: 'Unauthorized: A valid API Key in the Authorization header is required.'
    })
  }

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
      throw createError({ statusCode: 400, message: 'Invalid JSON-RPC 2.0 payload.' })
    }

    const { id, method: rpcMethod, params } = body
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

            const type = await db.query.contentTypes.findFirst({
              where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, typeSlug))
            })
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
            const AUTHOR_ROLES = ['super_admin', 'admin', 'editor', 'author']
            if (!AUTHOR_ROLES.includes(apiKeyRole ?? '')) {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to create content.` }] }
              break
            }

            const title = args?.title
            const slugVal = args?.slug
            const contentVal = args?.content || ''
            const typeSlug = args?.type || 'page'
            const statusVal = args?.status || 'draft'

            if (!title || !slugVal) {
              result = { content: [{ type: 'text', text: 'Error: title and slug are required.' }] }
              break
            }

            const type = await db.query.contentTypes.findFirst({
              where: and(eq(contentTypes.siteId, siteId), eq(contentTypes.slug, typeSlug))
            })
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
            const AUTHOR_ROLES = ['super_admin', 'admin', 'editor', 'author']
            if (!AUTHOR_ROLES.includes(apiKeyRole ?? '')) {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to update content.` }] }
              break
            }

            const id = args?.id
            if (!id) {
              result = { content: [{ type: 'text', text: 'Error: id is required.' }] }
              break
            }

            const existing = await db.query.contentItems.findFirst({
              where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId))
            })
            if (!existing) {
              result = { content: [{ type: 'text', text: `Error: Content item with ID "${id}" not found.` }] }
              break
            }

            const updates: Partial<typeof contentItems.$inferSelect> = {
              updatedAt: new Date().toISOString()
            }
            if (args.title !== undefined) updates.title = args.title
            if (args.slug !== undefined) updates.slug = args.slug
            if (args.content !== undefined) updates.content = args.content
            if (args.status !== undefined) {
              const PUBLISH_ROLES = ['super_admin', 'admin', 'editor']
              if (args.status === 'published' && !PUBLISH_ROLES.includes(apiKeyRole ?? '')) {
                result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to publish content.` }] }
                break
              }
              updates.status = args.status
              if (args.status === 'published' && !existing.publishedAt) {
                updates.publishedAt = new Date().toISOString()
              }
            }

            await db.update(contentItems)
              .set(updates)
              .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

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

            // Enforce author / editor role minimum to perform deletions
            if (apiKeyRole !== 'admin' && apiKeyRole !== 'super_admin' && apiKeyRole !== 'editor') {
              result = { content: [{ type: 'text', text: `Error: Role "${apiKeyRole}" is unauthorized to perform deletions.` }] }
              break
            }

            const existing = await db.query.contentItems.findFirst({
              where: and(eq(contentItems.id, id), eq(contentItems.siteId, siteId))
            })
            if (!existing) {
              result = { content: [{ type: 'text', text: `Error: Content item with ID "${id}" not found.` }] }
              break
            }

            await db.delete(contentItems)
              .where(and(eq(contentItems.id, id), eq(contentItems.siteId, siteId)))

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
      error = { code: -32603, message: err instanceof Error ? err.message : 'Internal error' }
    }

    // Format final JSON-RPC response payload
    const responsePayload = error
      ? { jsonrpc: '2.0', error, id }
      : { jsonrpc: '2.0', result, id }

    // If an active SSE stream connection is registered for this session, push to it
    if (sessionId) {
      const activeStream = activeStreams.get(sessionId)
      if (activeStream) {
        await activeStream.push({
          event: 'message',
          data: JSON.stringify(responsePayload)
        })
      }
    }

    // Always return in the POST body to support Streamable HTTP natively
    return responsePayload
  }

  throw createError({ statusCode: 405, message: 'Method Not Allowed' })
})
