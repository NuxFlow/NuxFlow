import { z } from 'zod'
import { findSiteForAccounts } from '../../utils/accounts-sites'
import { requireAccountsHost } from '../../utils/accounts-origin'

const querySchema = z.object({ site: z.string().min(1).max(64) })

/**
 * What the accounts origin's /authorize page needs to decide what to show: the site
 * being signed in to, who is signed in here (if anyone), and whether they're already part
 * of that site. See POST /api/accounts/authorize for the handoff itself.
 */
export default defineEventHandler(async (event) => {
  requireAccountsHost(event)
  const { site: siteId } = parseQuery(event, querySchema)

  const session = await getAuthSession(event)
  // A site of this Worker's own or one in a member pool (utils/accounts-sites.ts).
  const found = await findSiteForAccounts(event, siteId, session?.user.id ?? null)
  if (!found) throw notFound('This site isn\'t available')
  if (!session) return { site: found.site, user: null, isMember: false }

  // Only a real role on this site skips the "Continue to …?" step. A super admin can open
  // any site, but isn't automatically *its* person: right after a new site's setup the
  // browser is often still signed in here as the platform operator, and auto-continuing
  // signed that account in to the new site instead of offering "Use a different account".
  return {
    site: found.site,
    user: { name: session.user.name, email: session.user.email, image: session.user.image ?? null },
    isMember: Boolean(found.role),
  }
})
