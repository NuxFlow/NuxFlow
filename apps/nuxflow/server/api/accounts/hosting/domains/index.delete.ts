import { z } from 'zod'
import { hostingContext } from '../../../../utils/hosting-billing'
import { domainPanel, logDomainChange, ownedHostedSite, removeSiteDomain } from '../../../../utils/hosting-domains'

const bodySchema = z.object({ id: z.string().min(1), hostname: z.string().min(1).max(253) })

/** Disconnects one of the customer's extra addresses (and removes it from Cloudflare). */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  const { id, hostname } = await parseBody(event, bodySchema)
  const site = await ownedHostedSite(ctx.db, session.user.id, id)
  await removeSiteDomain(ctx, site.id, hostname)
  await logDomainChange(event, site.id, session.user.id, 'delete', hostname)
  return domainPanel(ctx, site)
})
