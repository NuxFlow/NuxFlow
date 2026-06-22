import { useDb } from '../utils/db'
import { contentItems, sites, siteSettings } from '@nuxflow/db/schema'
import { and, desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [site, descSetting, canonicalSetting] = await Promise.all([
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true, domain: true } }),
    db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.description')), columns: { value: true } }),
    db.query.siteSettings.findFirst({ where: and(eq(siteSettings.siteId, siteId), eq(siteSettings.key, 'seo.canonical_url')), columns: { value: true } }),
  ])

  const baseUrl = (canonicalSetting?.value as string | undefined)?.trim() || (site ? `https://${site.domain}` : useRuntimeConfig().public.siteUrl)
  const siteName = site?.name ?? 'NuxFlow'
  const siteDesc = (descSetting?.value as string | undefined) ?? `Content published by ${siteName}`

  const recent = await db.query.contentItems.findMany({
    where: and(eq(contentItems.siteId, siteId), eq(contentItems.status, 'published'), eq(contentItems.visibility, 'public')),
    orderBy: [desc(contentItems.publishedAt)],
    limit: 20,
    columns: { title: true, slug: true, excerpt: true },
  })

  const contentLinks = recent.map(p => {
    const desc = p.excerpt ? `: ${p.excerpt.slice(0, 120).replace(/\n/g, ' ')}` : ''
    return `- [${p.title}](${baseUrl}/${p.slug})${desc}`
  }).join('\n')

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return `# ${siteName}

> ${siteDesc}

## Recent Content
${contentLinks || '- No published content yet'}

## Content Discovery
- [Sitemap](${baseUrl}/sitemap.xml): Complete site structure in XML
- [RSS Feed](${baseUrl}/feed.xml): Latest content updates (RSS 2.0)
- [Atom Feed](${baseUrl}/atom.xml): Latest content updates (Atom 1.0)
- [Search](${baseUrl}/search): Full-text search across all content

## Content API
- [Posts](${baseUrl}/api/public/posts): Paginated JSON list of all published posts (supports ?page=&limit=)
- [Site Info](${baseUrl}/api/public/site): Site name, description, and canonical base URL
`
})
