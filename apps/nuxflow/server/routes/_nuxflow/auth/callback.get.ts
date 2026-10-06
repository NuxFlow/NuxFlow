import type { H3Event } from 'h3'
import { consumeSiteAuthCode, createSiteSession, readSiteSignInState, siteCallbackUrl } from '../../../utils/site-auth'
import { getSiteInfo } from '../../../utils/site-info'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

// A failed handoff stops here with a "try again" link instead of quietly starting over.
// Restarting automatically used to be the behaviour, but the accounts origin continues
// straight through for members, so any failure that repeats (a state cookie the browser
// won't keep, a code that's always refused) became an endless redirect loop showing
// "Signing you in…" with no error. One click to retry, and the reason in the Worker logs.
function signInFailed(event: H3Event, reason: string, returnTo: string): string {
  console.warn(`[site-auth] sign-in callback refused: ${reason}`)
  setResponseStatus(event, 400)
  setResponseHeaders(event, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  const retry = escapeHtml(`/_nuxflow/auth/start?${new URLSearchParams({ return_to: returnTo })}`)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign-in didn't complete</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f9fafb;color:#111827}main{max-width:420px;text-align:center}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:8px;background:#00dc82;color:#052e16;font-weight:600;text-decoration:none}p{color:#4b5563;line-height:1.5}</style></head>
<body><main><h1>Sign-in didn't complete</h1><p>The sign-in link expired or was opened in a different browser. This can also happen if the browser blocks cookies for this site.</p><a href="${retry}">Try again</a></main></body></html>`
}

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
  const returnTo = saved?.returnTo ?? '/admin'
  if (!saved) return signInFailed(event, 'no state cookie (expired, or blocked by the browser)', returnTo)
  if (!code || query.state !== saved.state) return signInFailed(event, 'state does not match this browser', returnTo)

  const site = await getSiteInfo(event, siteId)
  if (!site) throw createError({ statusCode: 404, statusMessage: 'Unknown site' })

  const grant = await consumeSiteAuthCode(event, code, siteId, siteCallbackUrl(site.domain))
  if (!grant) return signInFailed(event, 'code unknown, already used, expired, or for another site', returnTo)

  await createSiteSession(event, { userId: grant.userId, siteId, parentSessionId: grant.parentSessionId })
  return sendRedirect(event, saved.returnTo, 302)
})
