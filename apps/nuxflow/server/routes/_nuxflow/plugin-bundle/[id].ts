import { useDb } from '../../../utils/db'
import { getPluginClientBundle } from '../../../utils/cf-env'
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
  if (!site) throw createError({ statusCode: 404, message: 'Site not found' })

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, pluginId), eq(dynamicPlugins.siteId, site.id)),
  })
  if (!plugin || !plugin.isActive || !plugin.hasClient) {
    throw createError({ statusCode: 404, message: 'Plugin bundle not found' })
  }

  const bundle = await getPluginClientBundle(event, site.id, pluginId)
  if (!bundle) throw createError({ statusCode: 404, message: 'Plugin bundle not found in KV' })

  setHeader(event, 'content-type', 'application/javascript; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=3600')
  return send(event, bundle)
})
