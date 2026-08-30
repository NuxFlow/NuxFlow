import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { getMembershipTierByIdOrThrow } from '../../../utils/resource-queries'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const id = getRouterParam(event, 'id')!

  await getMembershipTierByIdOrThrow(db, siteId, id, 'Membership tier not found', { id: true })

  await db.delete(membershipTiers).where(and(eq(membershipTiers.id, id), eq(membershipTiers.siteId, siteId)))

  return { success: true }
})
