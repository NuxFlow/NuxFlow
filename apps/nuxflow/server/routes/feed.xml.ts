import { useDb } from '../utils/db'
import { contentItems, sites } from '@nuxflow/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const config = useRuntimeConfig()

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { name: true, domain: true },
  })

  const baseUrl = site ? `https://${site.domain}` : config.public.siteUrl

  const posts = await db.query.contentItems.findMany({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published')),
    orderBy: [desc(contentItems.publishedAt)],
    limit: 20,
    columns: { id: true, title: true, slug: true, excerpt: true, publishedAt: true, updatedAt: true },
  })

  const items = posts.map(p => `
    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${baseUrl}/${p.slug}</link>
      <guid isPermaLink="true">${baseUrl}/${p.slug}</guid>
      <pubDate>${new Date(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>
      ${p.excerpt ? `<description><![CDATA[${p.excerpt}]]></description>` : ''}
    </item>`).join('')

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=UTF-8')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${site?.name ?? 'NuxFlow'}</title>
    <link>${baseUrl}</link>
    <description>Latest posts from ${site?.name ?? 'NuxFlow'}</description>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`
})
