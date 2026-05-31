import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { apiKeys } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.siteId, siteId),
    columns: { id: true, name: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
  })
  return { apiKeys: keys }
})
