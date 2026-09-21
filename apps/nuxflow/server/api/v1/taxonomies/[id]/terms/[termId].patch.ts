import { z } from 'zod'
import { useDb } from '../../../../../utils/db'
import { requireRole } from '../../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../../utils/audit'
import { getTaxonomyByIdOrThrow, getTaxonomyTermByIdOrThrow } from '../../../../../utils/resource-queries'
import { taxonomyTerms } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

const bodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  parentId: z.string().nullish(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const taxonomyId = getRouterParam(event, 'id')!
  const termId = getRouterParam(event, 'termId')!
  const body = await parseBody(event, bodySchema)

  await getTaxonomyByIdOrThrow(db, siteId, taxonomyId)
  const term = await getTaxonomyTermByIdOrThrow(db, taxonomyId, termId)

  // parentId has no DB-level FK (see the identical check/comment in terms.post.ts), so
  // nothing else verifies a caller-supplied parentId is an existing term in THIS taxonomy,
  // and nothing stops a term being set as its own parent, which would break any code that
  // walks the parent chain.
  if (body.parentId) {
    if (body.parentId === termId) throw badRequest('A term cannot be its own parent')
    await getTaxonomyTermByIdOrThrow(db, taxonomyId, body.parentId, 'Parent term not found')
  }

  const termUpdate = db.update(taxonomyTerms).set(body).where(and(eq(taxonomyTerms.id, termId), eq(taxonomyTerms.taxonomyId, taxonomyId)))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update',
    resource: 'taxonomy_term',
    resourceId: termId,
    before: term,
    after: body,
  })

  await batchWithAudit(db, [termUpdate], auditInsert)

  return { id: termId }
})
