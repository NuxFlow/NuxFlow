import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { getRegisteredPlugin } from '../../../../utils/plugin-registry'
import { plugins } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const entry = getRegisteredPlugin(id)
  if (!entry) throw createError({ statusCode: 404, message: 'Plugin not found in registry' })

  const existing = await db.query.plugins.findFirst({
    where: and(eq(plugins.id, id), eq(plugins.siteId, siteId)),
  })
  if (existing) throw createError({ statusCode: 409, message: 'Plugin already installed' })

  await db.insert(plugins).values({
    id,
    siteId,
    packageName: entry.entrypoint,
    name: entry.name,
    version: entry.version,
    isActive: false,
    // Permissions are auto-approved: bundled plugins are authored by the
    // site developer and already included in the deployed bundle.
    settings: { permissionsApproved: true, approvedAt: new Date().toISOString() },
  })

  return { success: true }
})
