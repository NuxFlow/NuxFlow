import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { contentItems } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const query = getQuery(event)
  const format = (query.format as string) ?? 'json'

  const items = await db.query.contentItems.findMany({
    where: eq(contentItems.siteId, siteId),
  })

  if (format === 'csv') {
    const cols = ['id', 'title', 'slug', 'status', 'publishedAt', 'updatedAt'] as const
    const header = cols.join(',')
    const rows = items.map(i => cols.map(c => JSON.stringify(i[c] ?? '')).join(','))
    setHeader(event, 'Content-Type', 'text/csv')
    setHeader(event, 'Content-Disposition', 'attachment; filename="content-export.csv"')
    return [header, ...rows].join('\n')
  }

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Content-Disposition', 'attachment; filename="content-export.json"')
  return JSON.stringify(items, null, 2)
})
