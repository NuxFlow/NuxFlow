import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { forms } from '@nuxflow/db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const items = await db.query.forms.findMany({
    where: eq(forms.siteId, siteId),
    orderBy: [desc(forms.updatedAt)],
    columns: { id: true, name: true, slug: true, status: true, createdAt: true, updatedAt: true },
  })
  return { forms: items }
})
