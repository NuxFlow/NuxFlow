import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { writeAuditLog } from '../../../utils/audit'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isHierarchical: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const existing = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)),
  })
  if (!existing) throw notFound('Taxonomy not found')

  await db.update(taxonomies).set(body).where(and(eq(taxonomies.id, id), eq(taxonomies.siteId, siteId)))

  await writeAuditLog(event, userId, {
    action: 'update',
    resource: 'taxonomy',
    resourceId: id,
    before: existing,
    after: body,
  })

  return { id }
})
