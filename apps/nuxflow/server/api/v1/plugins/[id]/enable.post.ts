import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { plugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const plugin = await db.query.plugins.findFirst({
    where: and(eq(plugins.id, id), eq(plugins.siteId, siteId)),
  })
  if (!plugin) throw createError({ statusCode: 404, message: 'Plugin not found' })

  await db.update(plugins).set({ isActive: true }).where(and(eq(plugins.id, id), eq(plugins.siteId, siteId)))
  return { success: true, redeployRequired: true }
})
