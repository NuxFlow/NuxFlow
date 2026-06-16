import type { H3Event } from 'h3'
import { getAnalyticsEngine } from './cf-env'

export function trackPageView(event: H3Event, opts: { siteId: string; slug: string }): void {
  const ae = getAnalyticsEngine(event)
  if (!ae) return

  const country = getRequestHeader(event, 'cf-ipcountry') ?? 'XX'
  const referer = (getRequestHeader(event, 'referer') ?? '').slice(0, 256)

  ae.writeDataPoint({
    blobs: [opts.slug, country, referer],
    doubles: [1],
    indexes: [opts.siteId],
  })
}
