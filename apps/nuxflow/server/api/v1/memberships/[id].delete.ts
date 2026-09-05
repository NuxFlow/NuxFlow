import { membershipTiers, subscriptions } from '@nuxflow/db/schema'
import { and, eq, ne, count } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { scopedById } from '../../../utils/db-helpers'
import { requireRole } from '../../../utils/permissions'
import { buildAuditLogInsert, batchWithAudit } from '../../../utils/audit'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'
import { conflict } from '../../../utils/response'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  const existing = await getMembershipTierByIdOrThrow(db, siteId, id, 'Membership tier not found')

  // Refuse to orphan paying subscribers — a tier can only be deleted once nobody
  // holds a non-cancelled subscription against it.
  const [activeCountRow] = await db.select({ value: count() })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.siteId, siteId),
      eq(subscriptions.tierId, id),
      ne(subscriptions.status, 'cancelled'),
    ))
  const activeCount = activeCountRow?.value ?? 0

  if (activeCount > 0) {
    throw conflict(
      `Cannot delete "${existing.name}": ${activeCount} subscriber${activeCount === 1 ? '' : 's'} still ${activeCount === 1 ? 'has' : 'have'} an active subscription on this tier. Migrate or cancel ${activeCount === 1 ? 'them' : 'those subscriptions'} first.`,
    )
  }

  const tierDelete = db.delete(membershipTiers).where(scopedById(membershipTiers.id, id, membershipTiers.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'delete', resource: 'membership_tier', resourceId: id, before: existing })
  await batchWithAudit(db, [tierDelete], auditInsert)

  return noContent(event)
})
