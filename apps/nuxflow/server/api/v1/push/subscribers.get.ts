import { requireRole } from '../../../utils/permissions'
import { useDb } from '../../../utils/db'
import { pushSubscriptions } from '@nuxflow/db/schema'
import { eq, count } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const siteId = requireSiteId(event)
  const db = useDb(event)

  const [row] = await db
    .select({ n: count() })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.siteId, siteId))

  return { count: row?.n ?? 0 }
})
