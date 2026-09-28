import { consumeSiteAuthCode, createSiteSession, readSiteSignInState, siteCallbackUrl } from '../../../utils/site-auth'
import { getSiteInfo } from '../../../utils/site-info'

// Step 3 (see utils/site-auth.ts): the accounts origin sends the browser back here with a
// one-time code. The `state` must match the cookie step 1 set in *this* browser — without
// that, anyone could send a victim a link that silently signs them in to the attacker's
// account on this site. The code is exchanged server-side and deleted as it's read.
export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })

  const query = getQuery(event)
  const saved = readSiteSignInState(event)
  const code = typeof query.code === 'string' ? query.code : ''
  if (!saved || !code || query.state !== saved.state) {
    // Expired or opened in another browser — just start again.
    return sendRedirect(event, `/_nuxflow/auth/start?${new URLSearchParams({ return_to: saved?.returnTo ?? '/admin' })}`, 302)
  }

  const site = await getSiteInfo(event, siteId)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })

  const grant = await consumeSiteAuthCode(event, code, siteId, siteCallbackUrl(site.domain))
  if (!grant) {
    return sendRedirect(event, `/_nuxflow/auth/start?${new URLSearchParams({ return_to: saved.returnTo })}`, 302)
  }

  await createSiteSession(event, { userId: grant.userId, siteId, parentSessionId: grant.parentSessionId })
  return sendRedirect(event, saved.returnTo, 302)
})
