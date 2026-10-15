import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { siteDomains } from '@nuxflow/db/schema'
import { hostingContext } from '../../../../utils/hosting-billing'
import { domainPanel, ownedHostedSite, refreshCustomDomain } from '../../../../utils/hosting-domains'
import { rateLimit } from '../../../../utils/rate-limit'

const bodySchema = z.object({ id: z.string().min(1), hostname: z.string().min(1).max(253) })

/** "Check now": asks Cloudflare for one of the customer's domains' latest status. */
export default defineEventHandler(async (event) => {
  const ctx = await hostingContext(event)
  const session = await requireSession(event)
  await rateLimit(event, { limit: 60, windowMs: 60 * 60_000, keyPrefix: 'hosting-domain-check' })
  const { id, hostname } = await parseBody(event, bodySchema)
  const site = await ownedHostedSite(ctx.db, session.user.id, id)
  const row = await ctx.db.query.siteDomains.findFirst({ where: and(eq(siteDomains.siteId, site.id), eq(siteDomains.hostname, hostname)) })
  if (!row) throw notFound("That address isn't connected to this site.")
  try {
    await refreshCustomDomain(ctx, row)
  }
  catch (err) {
    throw createError({ statusCode: 502, message: `Couldn't reach Cloudflare: ${(err as Error).message}` })
  }
  return domainPanel(ctx, site)
})
