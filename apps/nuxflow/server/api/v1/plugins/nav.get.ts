import { useDb } from '../../../utils/db'
import { plugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { PLUGIN_REGISTRY } from '../../../utils/plugin-registry'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const activePlugins = await db.query.plugins.findMany({
    where: and(eq(plugins.siteId, siteId), eq(plugins.isActive, true)),
  })

  const navItems = activePlugins.flatMap((plugin) => {
    const entry = PLUGIN_REGISTRY.find(
      r => r.entrypoint === plugin.packageName || r.id === plugin.packageName,
    )
    return entry?.adminPages ?? []
  })

  return { navItems }
})
