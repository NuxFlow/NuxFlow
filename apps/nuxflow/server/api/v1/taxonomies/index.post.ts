import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { created } from '../../../utils/response'
import { taxonomies } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { ulid } from 'ulid'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  isHierarchical: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const body = await parseBody(event, bodySchema)

  const existing = await db.query.taxonomies.findFirst({
    where: and(eq(taxonomies.siteId, siteId), eq(taxonomies.slug, body.slug)),
  })
  if (existing) throw conflict(`Taxonomy slug "${body.slug}" already exists`)

  const id = ulid()
  const taxonomyInsert = db.insert(taxonomies).values({ id, siteId, ...body })

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'create',
    resource: 'taxonomy',
    resourceId: id,
    after: body,
  })

  await batchWithAudit(db, [taxonomyInsert], auditInsert)

  return created(event, { id })
})
