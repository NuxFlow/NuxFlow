import { useDb } from '../utils/db'
import { sites, siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Googlebot-Extended',
  'cohere-ai',
  'CCBot',
  'Applebot-Extended',
  'FacebookBot',
]

export default defineEventHandler(async (event) => {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const rows = await db.query.siteSettings.findMany({
    where: and(
      eq(siteSettings.siteId, siteId),
      inArray(siteSettings.key, ['seo.robots', 'seo.canonical_url', 'seo.ai_crawlers']),
    ),
    columns: { key: true, value: true },
  })

  const kv = Object.fromEntries(rows.map(r => [r.key, r.value as string | undefined]))

  const site = await db.query.sites.findFirst({
    where: eq(sites.id, siteId),
    columns: { domain: true },
  })

  const robotsValue = kv['seo.robots'] ?? 'index'
  const aiCrawlers = kv['seo.ai_crawlers'] ?? 'allow'
  const baseUrl = kv['seo.canonical_url']?.trim() || (site ? `https://${site.domain}` : useRuntimeConfig().public.siteUrl)

  setHeader(event, 'Content-Type', 'text/plain; charset=UTF-8')

  if (robotsValue === 'noindex') {
    return `User-agent: *\nDisallow: /\n`
  }

  const aiRules = aiCrawlers === 'disallow'
    ? AI_CRAWLERS.map(bot => `User-agent: ${bot}\nDisallow: /`).join('\n\n') + '\n\n'
    : ''

  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api

${aiRules}Sitemap: ${baseUrl}/sitemap.xml
`
})
