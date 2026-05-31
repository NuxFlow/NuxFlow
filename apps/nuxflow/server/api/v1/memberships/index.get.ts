import { membershipTiers } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'

export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const tiers = await db.query.membershipTiers.findMany({
    where: eq(membershipTiers.siteId, siteId),
    orderBy: (t, { asc }) => [asc(t.price)],
  })

  return { tiers }
})
