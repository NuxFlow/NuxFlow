import type { H3Event } from 'h3'
import { notFound } from './response'

/**
 * The site this request is for, as resolved by 02.multi-site.ts (or set by createSystemEvent()
 * for work with no request). 404 when there is none: the accounts origin, an unknown host, or
 * a route that skips site resolution (setup, auth).
 */
export function requireSiteId(event: H3Event): string {
  const siteId = event.context.siteId
  if (!siteId) notFound('Site not found')
  return siteId
}
