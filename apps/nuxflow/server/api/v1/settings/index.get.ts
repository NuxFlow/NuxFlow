import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { id: true, name: true, domain: true, locale: true, timezone: true, status: true },
  })

  if (!site) throw createError({ statusCode: 404, message: 'Site not found' })

  const settingRows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId)),
  })

  const settings: Record<string, unknown> = {}
  for (const row of settingRows) {
    settings[row.key] = row.value
  }

  return { site, settings }
})
