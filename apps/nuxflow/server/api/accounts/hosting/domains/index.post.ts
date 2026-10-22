import { z } from 'zod'
import { hostingContext } from '../../../../utils/hosting-billing'
import { addCustomDomain, domainPanel, logDomainChange, ownedHostedSite } from '../../../../utils/hosting-domains'
import { rateLimit } from '../../../../utils/rate-limit'

const bodySchema = z.object({ id: z.string().min(1), hostname: z.string().trim().min(3).max(253) })

/** Connects the customer's own domain to their site (registers it with Cloudflare). */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  await rateLimit(event, { limit: 10, windowMs: 60 * 60_000, keyPrefix: 'hosting-domain-add' })
  const { id, hostname } = await parseBody(event, bodySchema)
  const site = await ownedHostedSite(ctx, session.user.id, id)
  const row = await addCustomDomain(ctx, site, hostname)
  await logDomainChange(ctx, event, site, session.user.id, 'create', row.hostname)
  return domainPanel(ctx, site)
})
