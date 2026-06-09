import { membershipTiers } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const tiers = await db.query.membershipTiers.findMany({
    where: eq(membershipTiers.siteId, siteId),
    orderBy: (t, { asc }) => [asc(t.price)],
    columns: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      interval: true,
      features: true,
      isActive: true,
    },
  })

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')

  return { tiers: tiers.filter(t => t.isActive) }
})
