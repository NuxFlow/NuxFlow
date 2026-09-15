import { useDb } from '../../../utils/db'
import { getPluginClientBundle } from '../../../utils/cf-env'
import { assertCodeIntegrity } from '../../../utils/plugin-signing'
import { dynamicPlugins, sites } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const pluginId = getRouterParam(event, 'id')!
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

  // Verify KV content against the checksum stored in D1 at install time.
  // A mismatch means the KV entry was modified after the signed install — hard stop.
  if (plugin.clientChecksum) {
    await assertCodeIntegrity(bundle, plugin.clientChecksum, 'client bundle')
  }

  setHeader(event, 'content-type', 'application/javascript; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  // Fetched via dynamic import() from inside the sandboxed plugin iframe
  // (_nuxflow/plugin-frame/...), whose sandbox="allow-scripts" (no allow-same-origin)
  // gives it an opaque origin — the browser treats that import as cross-origin and
  // requires this header regardless of it being "our own" domain. Safe to wildcard:
  // this response is checksum-verified public code, never varies per caller, and
  // never carries credentials.
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  return send(event, bundle)
})
