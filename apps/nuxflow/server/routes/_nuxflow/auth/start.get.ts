import { accountsUrl, isTenantHostInCentralMode } from '../../../utils/accounts-origin'
import { beginSiteSignIn, safeReturnPath } from '../../../utils/site-auth'

// Step 1 of signing in on a site's own domain (see utils/site-auth.ts): remember where to
// come back to, bind this browser with a `state` cookie, and go to the accounts origin.
export default defineEventHandler((event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })
  const query = getQuery(event)
  const returnTo = safeReturnPath(query.return_to)

  // Single-site install without an accounts origin: sign in right here.
  if (!isTenantHostInCentralMode(event)) {
    return sendRedirect(event, `/login?${new URLSearchParams({ redirect: returnTo })}`, 302)
  }

  const state = beginSiteSignIn(event, returnTo)
  const params = new URLSearchParams({ site: siteId, state })
  if (query.intent === 'join') params.set('intent', 'join')
  return sendRedirect(event, accountsUrl(`/authorize?${params}`), 302)
})
