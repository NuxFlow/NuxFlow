import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getDynamicPluginByIdOrThrow } from '../../../../utils/resource-queries'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getDynamicPluginByIdOrThrow(db, siteId, id)

  await db.update(dynamicPlugins)
    .set({ isActive: true })
    .where(and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, siteId)))

  return { success: true }
})
