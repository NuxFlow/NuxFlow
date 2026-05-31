import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { dynamicPlugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const plugin = await db.query.dynamicPlugins.findFirst({
    where: and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, siteId)),
  })
  if (!plugin) throw createError({ statusCode: 404, message: 'Dynamic plugin not found' })

  await db.update(dynamicPlugins)
    .set({ isActive: false })
    .where(and(eq(dynamicPlugins.id, id), eq(dynamicPlugins.siteId, siteId)))

  return { success: true }
})
