import { useDb } from '../../../../utils/db'
import { spawnPluginWorker, getPluginServerCode } from '../../../../utils/cf-env'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

// Proxy all methods under /_nuxflow/ext/{pluginId}/... to the plugin's Dynamic Worker.
// The worker is cached by `{pluginId}:{version}` so code updates invalidate the cache.
export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string | null
  const pluginId = getRouterParam(event, 'pluginId')!

  if (!siteId) throw createError({ statusCode: 400, message: 'Unknown site' })

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, pluginId), eq(dynamicPlugins.siteId, siteId)),
  })
  if (!plugin) throw createError({ statusCode: 404, message: 'Plugin not found' })
  if (!plugin.isActive) throw createError({ statusCode: 403, message: 'Plugin is not active' })
  if (!plugin.hasServer) throw createError({ statusCode: 404, message: 'Plugin has no server module' })

  const cacheId = `${pluginId}:${plugin.version}`
  const worker = spawnPluginWorker(event, cacheId, async (): Promise<string> => {
    const code = await getPluginServerCode(event, siteId, pluginId)
    if (!code) throw createError({ statusCode: 500, message: 'Plugin server code not found in KV' })
    return code
  })

  // Rebuild the request URL so the plugin worker receives the path after /ext/{pluginId}
  const url = getRequestURL(event)
  const pluginPath = url.pathname.replace(/^\/_nuxflow\/ext\/[^/]+/, '') || '/'
  const forwardUrl = new URL(pluginPath + (url.search || ''), 'https://plugin.internal')

  const forwardReq = new Request(forwardUrl.toString(), {
    method: event.method,
    headers: getHeaders(event) as HeadersInit,
    body: ['GET', 'HEAD'].includes(event.method) ? undefined : (await readRawBody(event) ?? undefined),
  })

  return worker.getEntrypoint().fetch(forwardReq)
})
