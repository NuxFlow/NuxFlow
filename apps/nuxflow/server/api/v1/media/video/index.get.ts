import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { videoAssets } from '@nuxflow/db/schema'
import { desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')
  const siteId = event.context.siteId as string
  const db = useDb(event)

  const list = await db.select()
    .from(videoAssets)
    .where(eq(videoAssets.siteId, siteId))
    .orderBy(desc(videoAssets.createdAt))
    .limit(500)

  return list
})
