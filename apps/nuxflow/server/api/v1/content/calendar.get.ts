import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { parseQuery } from '../../../utils/validate'
import { contentItems, contentTypes } from '@nuxflow/db/schema'
import { and, eq, or, gte, lte } from 'drizzle-orm'
import { z } from 'zod'

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
})

export default defineEventHandler(async (event) => {
  await requireRole(event, 'viewer')

  const db = useDb(event)
  const siteId = event.context.siteId as string
  const { from, to } = parseQuery(event, querySchema)

  const fromTs = `${from}T00:00:00.000Z`
  const toTs = `${to}T23:59:59.999Z`

  const types = await db.query.contentTypes.findMany({
    where: eq(contentTypes.siteId, siteId),
    columns: { id: true, slug: true, name: true, icon: true },
  })
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]))

  const rows = await db.query.contentItems.findMany({
    where: and(
      eq(contentItems.siteId, siteId),
      or(
        and(gte(contentItems.publishedAt, fromTs), lte(contentItems.publishedAt, toTs)),
        and(gte(contentItems.scheduledAt, fromTs), lte(contentItems.scheduledAt, toTs)),
      ),
    ),
    columns: {
      id: true,
      title: true,
      slug: true,
      status: true,
      typeId: true,
      publishedAt: true,
      scheduledAt: true,
    },
  })

  const items = rows.map(row => ({
    ...row,
    type: typeMap[row.typeId] ?? null,
    // Scheduled items anchor to their scheduled date; published items anchor to published date.
    calendarDate: (row.status === 'scheduled' && row.scheduledAt)
      ? row.scheduledAt.substring(0, 10)
      : (row.publishedAt?.substring(0, 10) ?? from),
  }))

  return { items }
})
