import { useDb } from '../../utils/db'
import { createEventStream } from 'h3'
import { ulid } from 'ulid'
import { errorMessage } from '../../utils/errors'
import { rateLimit } from '../../utils/rate-limit'
import { listToolDescriptors, callTool } from '../../utils/mcp-tools'

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
          // Descriptors (name/description/inputSchema) come from mcp-tools.ts, which
          // co-locates each tool's JSON-Schema inputSchema with the Zod schema that
          // actually validates it at call time (see the comment there).
          result = { tools: listToolDescriptors() }
          break
        }

        case 'tools/call': {
          const { name, arguments: args } = params || {}

          // Tool-specific logic (schemas, role/scope checks, the actual DB work) lives in
          // mcp-tools.ts — this handler is just protocol plumbing. apiKeyUserId/siteId are
          // already validated non-null above (see the guard right after auth).
          result = await callTool(name, args, {
            event,
            db,
            siteId: siteId as string,
            apiKeyUserId: apiKeyUserId as string,
            apiKeyRole,
          })
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
