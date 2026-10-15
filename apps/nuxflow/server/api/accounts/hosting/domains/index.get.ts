import { z } from 'zod'
import { hostingContext } from '../../../../utils/hosting-billing'
import { domainPanel, ownedHostedSite } from '../../../../utils/hosting-domains'

const querySchema = z.object({ id: z.string().min(1) })

/** A customer's site addresses: the main one, their own domains and their status. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  const { id } = parseQuery(event, querySchema)
  const site = await ownedHostedSite(ctx.db, session.user.id, id)
  return domainPanel(ctx, site)
})
