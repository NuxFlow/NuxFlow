import { z } from 'zod'
import { findSiteForAccounts, joinSiteAsMember } from '../../utils/accounts-sites'
import { requireAccountsHost } from '../../utils/accounts-origin'
import { issueSiteAuthCode, siteCallbackUrl } from '../../utils/site-auth'
import { rateLimit } from '../../utils/rate-limit'

const bodySchema = z.object({
  site: z.string().min(1).max(64),
  state: z.string().min(16).max(128),
  join: z.boolean().optional(),
})

/**
 * Step 2 of site sign-in (see utils/site-auth.ts): the signed-in person has confirmed they
 * want to continue to this site. Issues a one-time code bound to them, the site and this
 * accounts session, and returns the site's callback URL to send the browser to.
 *
 * The callback URL is always built from the site's stored domain — never taken from the
 * request — so a code can only ever be delivered to the real site. Being signed in here
 * doesn't by itself make anyone a member of a site: the site session only proves who they
 * are, and the site's own role checks decide what they may do. `join` adds the member role
 * on a site with public registration open (an existing account "registering").
 *
 * A POST from the page itself (CSRF-checked by 03.csrf.ts) rather than a bare GET redirect,
 * so no other site can silently log a visitor in to itself — and learn who they are —
 * just by sending them through this URL; a site that isn't one of theirs yet always gets
 * an explicit "Continue" click first (see pages/authorize.vue).
 */
export default defineEventHandler(async (event) => {
  requireAccountsHost(event)
  await rateLimit(event, { limit: 30, windowMs: 60_000, keyPrefix: 'accounts-authorize' })
  const session = await requireSession(event)
  const body = await parseBody(event, bodySchema)

  // One of this Worker's own sites, or one in a member pool (utils/accounts-sites.ts).
  const userId = session.user.id
  const found = await findSiteForAccounts(event, body.site, userId)
  if (!found) throw notFound('This site isn\'t available')
  const { site } = found

  if (body.join) {
    await joinSiteAsMember(event, found, {
      id: userId,
      name: session.user.name,
      email: session.user.email,
      emailVerified: Boolean(session.user.emailVerified),
      image: session.user.image ?? null,
    })
  }

  // The domain comes from the site's own record (its pool's, for a pool site) — never the request.
  const redirectUri = siteCallbackUrl(site.domain)
  const code = await issueSiteAuthCode(event, {
    userId,
    siteId: site.id,
    parentSessionId: session.session.id,
    redirectUri,
  })
  return { redirect: `${redirectUri}?${new URLSearchParams({ code, state: body.state })}` }
})
