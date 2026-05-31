import { useDb } from '../utils/db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const setting = await db.query.siteSettings.findFirst({
    where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.robots')),
  })

  const robotsValue = (setting?.value as string | undefined) ?? 'index'
  const baseUrl = config.public.siteUrl

  setHeader(event, 'Content-Type', 'text/plain')

  if (robotsValue === 'noindex') {
    return `User-agent: *\nDisallow: /\n`
  }

  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${baseUrl}/sitemap.xml\n`
})
