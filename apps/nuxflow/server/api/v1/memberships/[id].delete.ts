import { membershipTiers, subscriptions, contentItems } from '@nuxflow/db/schema'
import { and, eq, ne, count, sql } from 'drizzle-orm'
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

  // Also refuse to orphan gated content — a content item's `settings.access` (the
  // editor's "Content access" control, see deriveVisibilityFromSettings in
  // content-queries.ts) can reference this tier by id (`tier:<id>`) even when nobody is
  // currently subscribed to it, which the subscriber check above can't see. Deleting the
  // tier out from under that setting would leave the page permanently gated behind a
  // tier id that no longer exists, with no UI path back to an unlocked state.
  const [gatedCountRow] = await db.select({ value: count() })
    .from(contentItems)
    .where(and(
      eq(contentItems.siteId, siteId),
      sql`json_extract(${contentItems.settings}, '$.access') = ${`tier:${id}`}`,
    ))
  const gatedCount = gatedCountRow?.value ?? 0

  if (gatedCount > 0) {
    throw conflict(
      `Cannot delete "${existing.name}": ${gatedCount} content item${gatedCount === 1 ? '' : 's'} still ${gatedCount === 1 ? 'restricts' : 'restrict'} access to this tier. Change ${gatedCount === 1 ? 'its' : 'their'} access setting first.`,
    )
  }

  const tierDelete = db.delete(membershipTiers).where(scopedById(membershipTiers.id, id, membershipTiers.siteId, siteId))

  const auditInsert = buildAuditLogInsert(event, userId, { action: 'delete', resource: 'membership_tier', resourceId: id, before: existing })
  await batchWithAudit(db, [tierDelete], auditInsert)

  return noContent(event)
})
