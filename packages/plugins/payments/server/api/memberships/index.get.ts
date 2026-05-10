import { membershipTiers } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string
  const db = useDb()

  const tiers = await db.query.membershipTiers.findMany({
    where: and(eq(membershipTiers.siteId, siteId), eq(membershipTiers.isActive, true)),
    orderBy: (t, { asc }) => [asc(t.price)],
  })

  return { tiers }
})
