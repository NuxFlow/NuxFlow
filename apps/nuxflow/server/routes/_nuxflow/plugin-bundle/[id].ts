import type { H3Event } from 'h3'
import { useDb } from '../../../utils/db'
import { getPluginClientBundle } from '../../../utils/cf-plugin-kv'
import { assertCodeIntegrity } from '../../../utils/plugin-signing'
import { dynamicPlugins, sites } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { withEdgeCache } from '../../../utils/edge-cache'

// This bundle is identical for every visitor until the plugin is next installed/updated/
// disabled — verification (checksum + the 2 D1 lookups it takes to find the KV entry) has
// no reason to re-run on every request. Cached via the Workers Cache API (not just the
// Cache-Control header below, which alone doesn't guarantee an edge cache hit for a
// Worker-originated dynamic route — see withEdgeCache's own doc comment) and purged
// explicitly by [id]/disable.post.ts and [id]/index.delete.ts whenever the bundle a
// cached entry points at could go stale.
async function loadAndVerifyBundle(event: H3Event, pluginId: string): Promise<string> {
  const db = useDb(event)
  const host = getHeader(event, 'host')?.split(':')[0] ?? ''

  const site = await db.query.sites.findFirst({
    where: eq(sites.domain, host),
    columns: { id: true },
  })
  if (!site) throw notFound('Site not found')

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, pluginId), eq(dynamicPlugins.siteId, site.id)),
  })
  if (!plugin || !plugin.isActive || !plugin.hasClient) {
    throw notFound('Plugin bundle not found')
  }

  const bundle = await getPluginClientBundle(event, site.id, pluginId)
  if (!bundle) throw notFound('Plugin bundle not found in KV')

  // Fails closed: a plugin marked hasClient must have a recorded checksum to be served at
  // all — mirrors _nuxflow/ext/[pluginId]/[...path].ts's identical guard for server code.
  // Skipping verification when clientChecksum was merely absent (rather than mismatched)
  // was the gap that let an unsigned bundle smuggled in via backup restore (see the
  // superRefine on backupDynamicPluginSchema in backup.ts) be served unverified to every
  // visitor's sandboxed iframe.
  if (!plugin.clientChecksum) {
    throw createError({ statusCode: 500, message: 'Plugin client bundle has no recorded checksum — refusing to serve unverified code.' })
  }
  // Verify KV content against the checksum stored in D1 at install time.
  // A mismatch means the KV entry was modified after the signed install — hard stop.
  await assertCodeIntegrity(bundle, plugin.clientChecksum, 'client bundle')

  return bundle
}

export default defineEventHandler(async (event) => {
  const pluginId = getRouterParam(event, 'id')!

  setHeader(event, 'content-type', 'application/javascript; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  // Fetched via dynamic import() from inside the sandboxed plugin iframe
  // (_nuxflow/plugin-frame/...), whose sandbox="allow-scripts" (no allow-same-origin)
  // gives it an opaque origin — the browser treats that import as cross-origin and
  // requires this header regardless of it being "our own" domain. Safe to wildcard:
  // this response is checksum-verified public code, never varies per caller, and
  // never carries credentials.
  setHeader(event, 'Access-Control-Allow-Origin', '*')

  // withEdgeCache only ever caches a successful compute() result — a thrown notFound()/
  // createError() above propagates straight through and is never written to the cache.
  const bundle = await withEdgeCache(event, 3600, () => loadAndVerifyBundle(event, pluginId))
  return send(event, bundle)
})
