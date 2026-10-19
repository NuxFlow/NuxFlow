import type { H3Event } from 'h3'
import { useDb } from '../../../../utils/db'
import { invokePlugin, RESERVED_PLUGIN_PATH_PREFIX } from '../../../../utils/plugin-runtime'
import { PLUGIN_EXT_CORS_HEADERS, confinePluginResponseHeaders } from '../../../../utils/plugin-response'
import { getAuthSession } from '../../../../utils/auth'
import { getUserSiteRole } from '../../../../utils/permissions'
import { isCrossOriginUnsafeRequest } from '../../../../utils/csrf'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Headers safe to forward into untrusted plugin code. Deliberately an allowlist, not a
// denylist: `getHeaders(event)` includes `Cookie` and `Authorization`, and a plugin only
// needs a self-signed Ed25519 key to be installed (proves authorship consistency, not that
// the code is benign) — forwarding those would hand every installed plugin the caller's
// live session/API-key credentials. Worker Loader instances are cached and reused across
// requests, so a plugin could also stash a captured header in module-level state on one
// request and echo it back on a later one. The `x-nuxflow-*` identity headers below are
// never in this list, so a caller can't set them — only this route can.
const FORWARDABLE_HEADERS = new Set([
  'content-type', 'accept', 'accept-language', 'user-agent', 'x-requested-with',
])

function pickForwardableHeaders(event: H3Event): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(getHeaders(event))) {
    if (value !== undefined && FORWARDABLE_HEADERS.has(key.toLowerCase())) out[key] = value
  }
  return out
}

// With the `user:read` permission, a plugin learns who is calling — the user id and their
// role on this site, never the session or its cookie. Left out for a cross-origin unsafe
// request (the same test the /api CSRF middleware applies), so another site can't make a
// signed-in visitor's browser act on a plugin route with their identity attached.
async function identityHeaders(event: H3Event, siteId: string): Promise<Record<string, string>> {
  if (isCrossOriginUnsafeRequest(event)) return {}
  const session = await getAuthSession(event).catch(() => null)
  if (!session?.user?.id) return {}
  const role = await getUserSiteRole(useDb(event), session.user.id, siteId)
  return {
    'x-nuxflow-user-id': session.user.id,
    ...(role ? { 'x-nuxflow-user-role': role.role } : {}),
  }
}

// Proxy all methods under /_nuxflow/ext/{pluginId}/... to the plugin's Dynamic Worker.
// The worker is spawned with only the capabilities an admin approved — see
// server/utils/plugin-runtime.ts for how it's cached and bound.
export default defineEventHandler(async (event) => {
  if (event.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(PLUGIN_EXT_CORS_HEADERS)) setHeader(event, key, value)
    setResponseStatus(event, 204)
    return null
  }

  const db = useDb(event)
  const siteId = event.context.siteId as string | null
  const pluginId = getRouterParam(event, 'pluginId')!

  if (!siteId) throw badRequest('Unknown site')

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, pluginId), eq(dynamicPlugins.siteId, siteId)),
  })
  if (!plugin) throw notFound('Plugin not found')
  if (!plugin.isActive) throw forbidden('Plugin is not active')
  if (!plugin.hasServer) throw notFound('Plugin has no server module')

  // Rebuild the request URL so the plugin worker receives the path after /ext/{pluginId}
  const url = getRequestURL(event)
  const pluginPath = url.pathname.replace(/^\/_nuxflow\/ext\/[^/]+/, '') || '/'
  // Reserved for NuxFlow's own calls (event hooks) — a visitor can't forge a hook delivery.
  if (pluginPath === RESERVED_PLUGIN_PATH_PREFIX || pluginPath.startsWith(`${RESERVED_PLUGIN_PATH_PREFIX}/`)) {
    throw notFound('Not found')
  }
  const forwardUrl = new URL(pluginPath + (url.search || ''), 'https://plugin.internal')

  const headers = pickForwardableHeaders(event)
  const identity = plugin.grantedPermissions?.includes('user:read') ? await identityHeaders(event, siteId) : {}
  Object.assign(headers, identity)

  const forwardReq = new Request(forwardUrl.toString(), {
    method: event.method,
    headers,
    body: ['GET', 'HEAD'].includes(event.method) ? undefined : (await readRawBody(event) ?? undefined),
  })

  const res = await invokePlugin(event, plugin, forwardReq)
  const responseHeaders = confinePluginResponseHeaders(res.headers)
  // An answer built for one signed-in person must never be stored and handed to another.
  if (Object.keys(identity).length > 0) responseHeaders.set('Cache-Control', 'private, no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: responseHeaders })
})
