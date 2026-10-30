import { useDb } from '../utils/db'
import { isAccountsHost } from '../utils/accounts-origin'
import { hasSuperAdminRole } from '../utils/permissions'
import { resolveSiteForHost } from '../utils/site-resolution'

// Resolves the request's site (utils/site-resolution.ts) and enforces what its status
// means for this request: extra-address redirects, unknown hosts, suspension, moves and
// maintenance mode.

// getAuthSession is called as a Nitro auto-import, not imported — see site-resolution.ts.

export default defineEventHandler(async (event) => {
  // The accounts origin (central sign-in — see utils/accounts-origin.ts) is never a site:
  // no content, no settings, no custom code, and none of the single-site/preview
  // fallbacks below may ever map it onto one.
  if (isAccountsHost(event)) {
    event.context.isAccountsHost = true
    event.context.siteId = null
    event.context.siteStatus = null
    event.context.setupCompleted = true
    event.context.siteDomain = null
    return
  }

  // Let setup & auth API paths through before touching the DB — the schema
  // may not exist yet (fresh install / wiped DB awaiting migrations).
  // Pathname only; the query string is added back where a redirect needs it.
  const url = getRequestURL(event)
  const path = url.pathname
  if (path.startsWith('/api/v1/setup') || path.startsWith('/api/auth') || path === '/api/health') {
    return
  }

  let host = getHeader(event, 'host')?.split(':')[0] ?? ''
  if (host === '127.0.0.1' || host === '::1') {
    host = 'localhost'
  }

  const { site, unknownHost } = await resolveSiteForHost(event, host, path)

  event.context.siteId = site?.id ?? null
  event.context.siteStatus = site?.status ?? null
  event.context.setupCompleted = site?.setupCompleted ?? false
  // The site's own stored domain. Differs from the request host when the site was
  // reached through the single-site / *.workers.dev fallback (utils/site-resolution.ts) — 05.seo-headers.ts
  // uses this to keep those duplicate hostnames out of search indexes.
  event.context.siteDomain = site?.domain ?? null

  // An extra address: send visitors (and search engines) to the main one, keeping the
  // path. 308 for non-GET so a form post isn't turned into a GET. Certificate checks
  // under /.well-known/ are left alone.
  if (site?.redirectTo && site.redirectTo !== host && !path.startsWith('/.well-known/')) {
    const method = event.method.toUpperCase()
    return sendRedirect(event, `https://${site.redirectTo}${path}${url.search}`, method === 'GET' || method === 'HEAD' ? 301 : 308)
  }

  if (unknownHost) {
    setResponseStatus(event, 404)
    setHeader(event, 'X-Robots-Tag', 'noindex')
    if (path.startsWith('/api') || path.startsWith('/_')) {
      setHeader(event, 'Content-Type', 'application/json')
      return { statusCode: 404, statusMessage: 'No site is served at this address.' }
    }
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site not found</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#f8fafc}
  .wrap{text-align:center;max-width:480px;padding:2.5rem 2rem}
  .icon{font-size:3rem;margin-bottom:1.5rem}
  h1{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.75rem}
  p{color:#94a3b8;line-height:1.6;font-size:1rem}
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">🔍</div>
    <h1>Site not found</h1>
    <p>There's no website at this address. Check the address for typos, or contact the site's owner.</p>
  </div>
</body>
</html>`
  }

  if (site?.status === 'suspended') {
    // Unlike maintenance mode (self-service, temporary — /admin and /api stay open so
    // the site's own team can keep working), suspension is an operator-imposed block:
    // everything is closed, including /admin and /api, for everyone except a super
    // admin — who needs an escape hatch to reactivate the site again. A super admin's
    // access here is intentionally unconditional (not gated by a user_site_roles row on
    // THIS site), matching requireSuperAdmin()'s existing cross-site model — otherwise a
    // single-site install would have no way to recover from its only site being
    // suspended.
    let isPrivileged = false
    try {
      const session = await getAuthSession(event)
      if (session) isPrivileged = await hasSuperAdminRole(useDb(event), session.user.id)
    } catch {
      // Any session-check failure is treated as "not privileged" — never let it crash
      // the request or accidentally grant access to a suspended site.
    }

    if (!isPrivileged) {
      setResponseStatus(event, 403)
      if (path.startsWith('/api') || path.startsWith('/_')) {
        setHeader(event, 'Content-Type', 'application/json')
        return { statusCode: 403, statusMessage: 'This site has been suspended.' }
      }
      setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
      return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Site suspended</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#f8fafc}
  .wrap{text-align:center;max-width:480px;padding:2.5rem 2rem}
  .icon{font-size:3rem;margin-bottom:1.5rem}
  h1{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.75rem}
  p{color:#94a3b8;line-height:1.6;font-size:1rem}
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">🚫</div>
    <h1>Site suspended</h1>
    <p>This site is currently unavailable. If you believe this is a mistake, contact the platform operator.</p>
  </div>
</body>
</html>`
    }
  }

  // Being moved to another pool (utils/site-move.ts): nothing may change until the copy is
  // live, or it would be lost. Reading still works, so the admin can look around.
  const moving = site?.moveState === 'outgoing' || site?.moveState === 'moved'
  if (moving && !['GET', 'HEAD', 'OPTIONS'].includes(event.method.toUpperCase())) {
    setResponseStatus(event, 503)
    setHeader(event, 'Retry-After', 120)
    setHeader(event, 'Content-Type', 'application/json')
    return { statusCode: 503, statusMessage: 'This site is being moved to a new server. Changes are paused for a few minutes; please try again shortly.' }
  }

  if ((site?.status === 'maintenance' || moving) && !path.startsWith('/admin') && !path.startsWith('/api') && !path.startsWith('/_')) {
    setResponseStatus(event, 503)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Down for maintenance</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#f8fafc}
  .wrap{text-align:center;max-width:480px;padding:2.5rem 2rem}
  .icon{font-size:3rem;margin-bottom:1.5rem}
  h1{font-size:1.75rem;font-weight:700;letter-spacing:-.02em;margin-bottom:.75rem}
  p{color:#94a3b8;line-height:1.6;font-size:1rem}
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">🔧</div>
    <h1>Down for maintenance</h1>
    <p>We're making some improvements. We'll be back shortly — thank you for your patience.</p>
  </div>
</body>
</html>`
  }
})
