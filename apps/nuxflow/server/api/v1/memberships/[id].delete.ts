import { membershipTiers } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert } from '../../../utils/audit'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getMembershipTierByIdOrThrow(db, siteId, id, 'Membership tier not found')

  const tierDelete = db.delete(membershipTiers).where(scopedById(membershipTiers.id, id, membershipTiers.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'delete', resource: 'membership_tier', resourceId: id, before: existing })
  await db.batch(auditInsert ? [tierDelete, auditInsert] : [tierDelete])

  return noContent(event)
})
