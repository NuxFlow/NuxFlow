import { membershipTiers } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'
import { resolveSetting } from '../../utils/settings'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [tiers, signupsDisabledRaw, signupsDisabledMessage] = await Promise.all([
    db.query.membershipTiers.findMany({
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
    }),
    resolveSetting(event, 'payments.signups_disabled'),
    resolveSetting(event, 'payments.signups_disabled_message'),
  ])

  const signupsDisabled = signupsDisabledRaw === 'true'

  setHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')

  return {
    tiers: tiers.filter(t => t.isActive),
    signupsDisabled,
    signupsDisabledMessage: (signupsDisabledMessage as string | null) || 'New signups are temporarily paused.',
  }
})
