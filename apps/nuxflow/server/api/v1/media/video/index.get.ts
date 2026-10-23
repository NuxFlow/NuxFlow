import { useDb } from '../../../../utils/db'
import { requireRole } from '../../../../utils/permissions'
import { videoAssets } from '@nuxflow/db/schema'
import { desc, eq } from 'drizzle-orm'
import { requireSiteId } from '../../../../utils/site-context'
import { withAdminPlayback } from '../../../../utils/stream'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')
  const siteId = requireSiteId(event)
  const db = useDb(event)

  const list = await db.select()
    .from(videoAssets)
    .where(eq(videoAssets.siteId, siteId))
    .orderBy(desc(videoAssets.createdAt))
    .limit(500)

  // Signed links expire, so this list is never cached by the browser.
  setHeader(event, 'Cache-Control', 'private, no-store')
  return Promise.all(list.map(row => withAdminPlayback(event, siteId, row)))
})
