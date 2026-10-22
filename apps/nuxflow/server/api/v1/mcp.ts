import { useDb } from '../../utils/db'
import { errorMessage } from '../../utils/errors'
import { rateLimit } from '../../utils/rate-limit'
import { listToolDescriptors, callTool } from '../../utils/mcp-tools'
import { version } from '../../../package.json'

// MCP server over the Streamable HTTP transport, stateless: every JSON-RPC message is one
// POST, and the response is that POST's JSON body. No session or server-to-client stream is
// kept, so any isolate can answer any request — the older HTTP+SSE transport needed the
// GET stream and the later POST on the same isolate, which Workers don't guarantee.
// https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

// Newest first. A client asking for a version not listed here is answered with the newest.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

type JsonRpcId = string | number | null

interface JsonRpcError { code: number; message: string }

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id }
}

export default defineEventHandler(async (event) => {
  // GET would open a server-to-client SSE stream; this server never sends unprompted messages.
  if (getMethod(event) !== 'POST') {
    setHeader(event, 'Allow', 'POST')
    throw createError({ statusCode: 405, message: 'Method Not Allowed' })
  }

  // apiKeyUserId/apiKeyRole/siteId are set by 03.api-key-auth.ts from the Authorization header.
  const apiKeyUserId = event.context.apiKeyUserId
  const apiKeyRole = event.context.apiKeyRole
  const siteId = event.context.siteId

  if (!apiKeyUserId || !siteId) {
    throw unauthorized('Unauthorized: A valid API Key in the Authorization header is required.')
  }

  // One limit for every call, reads and writes alike — generous for one editor's client.
  await rateLimit(event, { limit: 60, windowMs: 60_000, keyPrefix: 'mcp' })

  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    setResponseStatus(event, 400)
    return rpcError(null, -32700, 'Parse error')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
    setResponseStatus(event, 400)
    return rpcError(null, -32600, 'Invalid Request: expected a single JSON-RPC 2.0 message')
  }

  const { id, method: rpcMethod, params } = body as { id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> }

  // A notification (no id) or a response from the client gets no reply body.
  if (id === undefined) {
    setResponseStatus(event, 202)
    return null
  }

  let result: unknown = null
  let error: JsonRpcError | null = null

  try {
    switch (rpcMethod) {
      case 'initialize': {
        const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
        result = {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'nuxflow', version },
        }
        break
      }

      case 'ping': {
        result = {}
        break
      }

      case 'tools/list': {
        // Descriptors come from mcp-tools.ts, next to the Zod schemas that validate each call.
        result = { tools: listToolDescriptors() }
        break
      }

      case 'tools/call': {
        // Schemas, role/scope checks and the work itself live in mcp-tools.ts.
        const { name, arguments: args } = (params ?? {}) as { name?: string; arguments?: unknown }
        result = await callTool(String(name ?? ''), args, { event, db: useDb(event), siteId, apiKeyUserId, apiKeyRole })
        break
      }

      default: {
        error = { code: -32601, message: `Method not found: ${String(rpcMethod)}` }
        break
      }
    }
  } catch (err: unknown) {
    error = { code: -32603, message: errorMessage(err, 'Internal error') }
  }

  return error ? { jsonrpc: '2.0', error, id } : { jsonrpc: '2.0', result, id }
})
