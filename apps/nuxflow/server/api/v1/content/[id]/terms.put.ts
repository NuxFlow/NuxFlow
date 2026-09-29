import { z } from 'zod'
import { useDb } from '../../../../utils/db'
import { requireRole, assertCanEditContentItem } from '../../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../../utils/audit'
import { getContentItemOrThrow } from '../../../../utils/content-queries'
import { purgeContentCache } from '../../../../utils/edge-cache'
import { getContentTermIds, getTermRefsWithAncestors, replaceContentTermsStatements, validateSiteTermIds } from '../../../../utils/taxonomy'

const bodySchema = z.object({
  termIds: z.array(z.string()).max(200),
})

// Headless/API replacement of an item's whole term set. The admin editor sends `termIds`
// with its normal content PATCH instead, so tagging follows the same save/autosave flow
// as every other field.
export default defineEventHandler(async (event) => {
  const { userId, role } = await requireRole(event, 'author')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const itemId = getRouterParam(event, 'id')!
  const body = await parseBody(event, bodySchema)

  const item = await getContentItemOrThrow(db, siteId, itemId, 'Content item not found', { id: true, slug: true, authorId: true, status: true })
  assertCanEditContentItem(role, userId, item)

  const termIds = await validateSiteTermIds(db, siteId, body.termIds)
  const previousTermIds = await getContentTermIds(db, itemId)

  const auditInsert = buildAuditLogInsert(event, userId, {
    action: 'update_terms', resource: 'content_item', resourceId: itemId, before: { termIds: previousTermIds }, after: { termIds },
  })

  const [first, ...rest] = replaceContentTermsStatements(db, itemId, termIds)
  await batchWithAudit(db, [first!, ...rest], auditInsert)

  // Both the newly added and the removed terms' archives (and their parents', which roll
  // sub-term content up) list this item differently now.
  await purgeContentCache(event, {
    slugs: [item.slug],
    taxonomyTerms: await getTermRefsWithAncestors(db, [...new Set([...previousTermIds, ...termIds])]),
  })

  return { success: true, termIds }
})
