import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { themes } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const items = await db.query.themes.findMany({ where: eq(themes.siteId, siteId) })
  return { themes: items }
})
