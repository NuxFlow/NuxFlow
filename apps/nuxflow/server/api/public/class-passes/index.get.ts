import { and, asc, eq } from 'drizzle-orm'
import { classPasses } from '@nuxflow/db/schema'
import { useDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { bookingPaymentsReady } from '../../../utils/class-passes'

// The passes on sale. Whether they can be bought is live, so this isn't edge-cached.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const siteId = requireSiteId(event)
  const [passes, canBuy] = await Promise.all([
    useDb(event).query.classPasses.findMany({
      where: and(eq(classPasses.siteId, siteId), eq(classPasses.isActive, true)),
      orderBy: [asc(classPasses.price)],
      columns: { id: true, name: true, description: true, credits: true, price: true, currency: true, validDays: true },
    }),
    bookingPaymentsReady(event),
  ])
  return { passes, canBuy }
})
