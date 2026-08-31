import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getContentItemOrThrow } from '../../../utils/content-queries'
import { contentItems } from '@nuxflow/db/schema'
import { scopedById } from '../../../utils/db-helpers'
import { purgeContentCache } from '../../../utils/edge-cache'
import { getContentItemTerms } from '@nuxflow/db/queries'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'editor')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getContentItemOrThrow(db, siteId, id, 'Not found', { id: true, title: true, slug: true })
  const terms = await getContentItemTerms(db, id)

  const itemDelete = db.delete(contentItems)
    .where(scopedById(contentItems.id, id, contentItems.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'delete',
    resource: 'content_item',
    resourceId: id,
    before: existing,
  })

  await batchWithAudit(db, [itemDelete], auditInsert)

  await purgeContentCache(event, {
    slugs: [existing.slug],
    taxonomyTerms: terms.map(t => ({ taxonomySlug: t.taxonomySlug, termSlug: t.termSlug })),
  })

  return noContent(event)
})
