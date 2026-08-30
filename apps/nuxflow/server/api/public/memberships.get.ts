import { membershipTiers } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'
import { resolveSetting } from '../../utils/settings'
import { withEdgeCache } from '../../utils/edge-cache'

const CACHE_MAX_AGE = 300

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=3600`)

  return withEdgeCache(event, CACHE_MAX_AGE, async () => {
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

    return {
      tiers: tiers.filter(t => t.isActive),
      signupsDisabled,
      signupsDisabledMessage: (signupsDisabledMessage as string | null) || 'New signups are temporarily paused.',
    }
  })
})
