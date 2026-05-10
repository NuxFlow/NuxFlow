import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { PLUGIN_REGISTRY } from '../../../utils/plugin-registry'
import { plugins } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const installed = await db.query.plugins.findMany({ where: eq(plugins.siteId, siteId) })
  const installedMap = new Map(installed.map(p => [p.id, p]))

  const result = PLUGIN_REGISTRY.map(entry => {
    const row = installedMap.get(entry.id)
    return {
      id: entry.id,
      name: entry.name,
      packageName: entry.entrypoint,
      version: entry.version,
      installed: Boolean(row),
      isActive: row?.isActive ?? false,
      installedAt: row?.installedAt ?? null,
    }
  })

  return { plugins: result }
})
