import { useDb } from '../utils/db'
import { findRedirect, redirectTarget } from '../utils/redirect-cache'

export default defineEventHandler(async (event) => {
  const siteId = event.context.siteId as string | null
  if (!siteId) return

  // Only check non-API, non-admin paths. Matching uses the pathname only — `event.path`
  // includes the query string, so `/old-page?utm_source=x` used to miss a `/old-page` rule.
  const url = getRequestURL(event)
  const path = url.pathname
  if (path.startsWith('/api') || path.startsWith('/admin') || path.startsWith('/_')) return

  const db = useDb(event)
  const redirect = await findRedirect(db, siteId, path)
  if (!redirect) return

  if (redirect.statusCode === 410) {
    // Gone: tells crawlers to drop the URL immediately rather than retrying a 404.
    setResponseStatus(event, 410)
    setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    setHeader(event, 'X-Robots-Tag', 'noindex')
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Gone</title></head><body><h1>This page has been removed</h1><p><a href="/">Go to the homepage</a></p></body></html>'
  }

  return sendRedirect(event, redirectTarget(redirect.to, url.search), redirect.statusCode)
})
