import type { H3Event } from 'h3'
import { useDb } from '../../../../utils/db'
import { spawnPluginWorker, getPluginServerCode } from '../../../../utils/cf-env'
import { assertCodeIntegrity } from '../../../../utils/plugin-signing'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Headers safe to forward into untrusted plugin code. Deliberately an allowlist, not a
// denylist: `getHeaders(event)` includes `Cookie` and `Authorization`, and a plugin only
// needs a self-signed Ed25519 key to be installed (proves authorship consistency, not that
// the code is benign) — forwarding those would hand every installed plugin the caller's
// live session/API-key credentials. Worker Loader instances are cached and reused across
// requests (see cacheId below), so a plugin can also stash a captured header in
// module-level state on one request and echo it back on a later one, making this an
// exfiltration path even with `globalOutbound: null` blocking direct network egress.
const FORWARDABLE_HEADERS = new Set([
  'content-type', 'accept', 'accept-language', 'user-agent', 'x-requested-with',
])

function pickForwardableHeaders(event: H3Event): HeadersInit {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(getHeaders(event))) {
    if (value !== undefined && FORWARDABLE_HEADERS.has(key.toLowerCase())) out[key] = value
  }
  return out
}

// Proxy all methods under /_nuxflow/ext/{pluginId}/... to the plugin's Dynamic Worker.
// The worker is cached by `{siteId}:{pluginId}:{serverChecksum}` — the checksum, not the
// free-text `version` field, is what's guaranteed to change whenever the stored code
// actually changes. `nuxflow plugin update` doesn't require (or enforce) a version bump, so
// keying on version let a code-only fix silently keep serving the pre-update code from any
// isolate that already had that cacheId warm. Keying on the checksum that's already computed
// and stored at install time makes any code change — version-bumped or not — always bust the
// loader cache. `siteId` is included so two unrelated tenants who happen to install
// byte-identical plugin code (the normal case for any shared/marketplace plugin) never
// resolve to the same Worker Loader instance — the D1 lookup below is already site-scoped,
// but the loader's own instance identity must be too, or that per-site authorization check
// can be satisfied while still handing the request to an isolate warmed by another site's
// traffic (and whatever module-level state that traffic left behind).
export default defineEventHandler(async (event) => {
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

  // Fails closed: a plugin marked hasServer must have a recorded checksum to run at all —
  // checked eagerly here (not just inside the cache-miss callback below) so a plugin missing
  // one fails on every request, not only the first spawn that populates the loader cache.
  if (!plugin.serverChecksum) {
    throw createError({ statusCode: 500, message: 'Plugin server module has no recorded checksum — refusing to execute unverified code.' })
  }

  const cacheId = `${siteId}:${pluginId}:${plugin.serverChecksum}`
  const worker = spawnPluginWorker(event, cacheId, async (): Promise<string> => {
    const code = await getPluginServerCode(event, siteId, pluginId)
    if (!code) throw createError({ statusCode: 500, message: 'Plugin server code not found in KV' })

    // Verify KV content against the checksum stored in D1 at install time.
    // A mismatch means the KV entry was modified after the signed install — hard stop.
    await assertCodeIntegrity(code, plugin.serverChecksum!, 'server module')

    return code
  })

  // Rebuild the request URL so the plugin worker receives the path after /ext/{pluginId}
  const url = getRequestURL(event)
  const pluginPath = url.pathname.replace(/^\/_nuxflow\/ext\/[^/]+/, '') || '/'
  const forwardUrl = new URL(pluginPath + (url.search || ''), 'https://plugin.internal')

  const forwardReq = new Request(forwardUrl.toString(), {
    method: event.method,
    headers: pickForwardableHeaders(event),
    body: ['GET', 'HEAD'].includes(event.method) ? undefined : (await readRawBody(event) ?? undefined),
  })

  return worker.getEntrypoint().fetch(forwardReq)
})
