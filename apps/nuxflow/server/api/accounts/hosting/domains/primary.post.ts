import { z } from 'zod'
import { hostingContext } from '../../../../utils/hosting-billing'
import { domainPanel, logDomainChange, makeMainDomain, ownedHostedSite } from '../../../../utils/hosting-domains'

const bodySchema = z.object({ id: z.string().min(1), hostname: z.string().min(1).max(253) })

/** Makes one of the customer's addresses their site's main one; the old main address redirects. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  const { id, hostname } = await parseBody(event, bodySchema)
  const site = await ownedHostedSite(ctx, session.user.id, id)
  await makeMainDomain(ctx, site, hostname)
  await logDomainChange(ctx, event, site, session.user.id, 'update', hostname)
  return domainPanel(ctx, { ...site, domain: hostname })
})
