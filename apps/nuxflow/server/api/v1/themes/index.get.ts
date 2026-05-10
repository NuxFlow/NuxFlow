import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const items = await db.query.themes.findMany({ where: eq(themes.siteId, siteId) })
  return { themes: items }
})
