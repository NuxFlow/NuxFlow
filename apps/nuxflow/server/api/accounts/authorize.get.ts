import { z } from 'zod'
import { useDb } from '../../utils/db'
import { getSiteBranding } from '../../utils/accounts-sites'
import { getUserSiteRole } from '../../utils/permissions'
import { isAccountsHost } from '../../utils/accounts-origin'

const querySchema = z.object({ site: z.string().min(1).max(64) })

/**
 * What the accounts origin's /authorize page needs to decide what to show: the site
 * being signed in to, who is signed in here (if anyone), and whether they're already part
 * of that site. See POST /api/accounts/authorize for the handoff itself.
 */
export default defineEventHandler(async (event) => {
  if (!isAccountsHost(event)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const { site: siteId } = parseQuery(event, querySchema)

  const site = await getSiteBranding(event, siteId)
  if (!site) throw notFound('This site isn\'t available')

  const session = await getAuthSession(event)
  if (!session) return { site, user: null, isMember: false }

  // Only a real role on this site skips the "Continue to …?" step. A super admin can open
  // any site, but isn't automatically *its* person: right after a new site's setup the
  // browser is often still signed in here as the platform operator, and auto-continuing
  // signed that account in to the new site instead of offering "Use a different account".
  const db = useDb(event)
  const isMember = Boolean(await getUserSiteRole(db, session.user.id, siteId))
  return {
    site,
    user: { name: session.user.name, email: session.user.email, image: session.user.image ?? null },
    isMember,
  }
})
