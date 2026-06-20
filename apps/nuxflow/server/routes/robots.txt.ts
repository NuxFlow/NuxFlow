import { useDb } from '../utils/db'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [robotsSetting, canonicalSetting, site] = await Promise.all([
    db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.robots')),
      columns: { value: true },
    }),
    db.query.siteSettings.findFirst({
      where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.canonical_url')),
      columns: { value: true },
    }),
    db.query.sites.findFirst({
      where: eq(sites.id, siteId),
      columns: { domain: true },
    }),
  ])

  const robotsValue = (robotsSetting?.value as string | undefined) ?? 'index'
  const baseUrl = (canonicalSetting?.value as string | undefined)?.trim()
    || (site ? `https://${site.domain}` : useRuntimeConfig().public.siteUrl)

  setHeader(event, 'Content-Type', 'text/plain')

  if (robotsValue === 'noindex') {
    return `User-agent: *\nDisallow: /\n`
  }

  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${baseUrl}/sitemap.xml\n`
})
